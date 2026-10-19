import type { PrismaClient } from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";
import type { CalendarEvent } from "@calcom/types/Calendar";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	send: vi.fn(),
	update: vi.fn(),
	findMany: vi.fn(),
	error: vi.fn(),
}));

vi.mock("@calcom/features/bookings/lib/EventManager", () => ({
	default: class {
		create = mocks.create;
	},
}));
vi.mock("@calcom/emails/email-manager", () => ({
	sendScheduledEmailsAndSMS: mocks.send,
}));
vi.mock("@calcom/features/webhooks/lib/getWebhooks", () => ({
	default: vi.fn(async () => []),
}));
vi.mock("@calcom/features/webhooks/lib/scheduleTrigger", () => ({
	scheduleTrigger: vi.fn(),
}));
vi.mock("@calcom/features/webhooks/lib/sendOrSchedulePayload", () => ({
	default: vi.fn(),
}));
vi.mock("./handleNewBooking/scheduleNoShowTriggers", () => ({
	scheduleNoShowTriggers: vi.fn(),
}));
vi.mock("@calcom/lib/tracing/factory", () => ({
	distributedTracing: {
		createSpan: vi.fn(() => ({})),
		getTracingLogger: vi.fn(() => ({ error: mocks.error })),
	},
}));

import { handleConfirmation } from "./handleConfirmation";

type ConfirmationArgs = Parameters<typeof handleConfirmation>[0];

function fixture(): ConfirmationArgs {
	const evt = {
		type: "60min",
		title: "Demo confirmation regression",
		uid: "confirmation-regression",
		startTime: "2026-09-17T10:00:00.000Z",
		endTime: "2026-09-17T11:00:00.000Z",
		location: "integrations:daily",
		organizer: { name: "Manager", email: "manager@example.test" },
		attendees: [{ name: "Attendee", email: "attendee@example.test" }],
	} as CalendarEvent;

	return {
		user: {
			id: 1,
			username: "demo",
			credentials: [],
		} as ConfirmationArgs["user"],
		evt,
		bookingId: 2,
		booking: {
			id: 2,
			uid: evt.uid ?? "confirmation-regression",
			userId: 1,
			startTime: new Date(evt.startTime),
			eventTypeId: 3,
			eventType: {
				id: 3,
				title: "Demo",
				length: 60,
				requiresConfirmation: true,
				price: 0,
				currency: "usd",
				description: null,
				metadata: {},
			},
			location: "integrations:daily",
			smsReminderNumber: null,
			status: BookingStatus.PENDING,
		},
		prisma: {
			booking: { update: mocks.update, findMany: mocks.findMany },
		} as unknown as PrismaClient,
		traceContext: {} as ConfirmationArgs["traceContext"],
	};
}

describe("manager booking confirmation emails", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.create.mockResolvedValue({ results: [], referencesToCreate: [] });
		mocks.send.mockResolvedValue(undefined);
		mocks.update.mockResolvedValue({
			id: 2,
			uid: "confirmation-regression",
			status: BookingStatus.ACCEPTED,
			attendees: [],
			responses: {
				name: { label: "your_name", value: "Attendee", isHidden: false },
				email: {
					label: "email_address",
					value: "attendee@example.test",
					isHidden: false,
				},
			},
			eventType: null,
		});
	});

	it("emails an accepted booking even when Daily meeting creation fails", async () => {
		const args = fixture();
		mocks.create.mockResolvedValue({
			results: [
				{ type: "daily_video", success: false, originalEvent: args.evt },
			],
			referencesToCreate: [],
		});

		await handleConfirmation(args);

		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 2 },
				data: expect.objectContaining({ status: BookingStatus.ACCEPTED }),
			}),
		);
		expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				uid: "confirmation-regression",
				attendees: args.evt.attendees,
			}),
			undefined,
			false,
			false,
			expect.anything(),
		);
		expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.send.mock.invocationCallOrder[0],
		);
	});

	it("passes successful meeting metadata to the confirmation email", async () => {
		mocks.create.mockResolvedValue({
			results: [
				{
					success: true,
					createdEvent: { hangoutLink: "https://meet.example.test/demo" },
				},
			],
			referencesToCreate: [],
		});
		await handleConfirmation(fixture());
		expect(mocks.send).toHaveBeenCalledWith(
			expect.objectContaining({
				additionalInformation: expect.objectContaining({
					hangoutLink: "https://meet.example.test/demo",
				}),
			}),
			undefined,
			false,
			false,
			expect.anything(),
		);
	});

	it("sends after acceptance when no integrations are connected", async () => {
		await handleConfirmation(fixture());
		expect(mocks.send).toHaveBeenCalledTimes(1);
		expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.send.mock.invocationCallOrder[0],
		);
	});

	it("honors the global email opt-out", async () => {
		await handleConfirmation({ ...fixture(), emailsEnabled: false });
		expect(mocks.update).toHaveBeenCalled();
		expect(mocks.send).not.toHaveBeenCalled();
	});

	it("preserves separate host and attendee notification preferences", async () => {
		const args = fixture();
		if (!args.booking.eventType) throw new Error("Missing event type fixture");
		args.booking.eventType.metadata = {
			disableStandardEmails: { confirmation: { host: true, attendee: false } },
		};
		await handleConfirmation(args);
		expect(mocks.send).toHaveBeenCalledWith(
			expect.anything(),
			undefined,
			true,
			false,
			expect.anything(),
		);
	});

	it("does not announce confirmation when saving acceptance fails", async () => {
		mocks.update.mockRejectedValueOnce(new Error("Database unavailable"));
		await expect(handleConfirmation(fixture())).rejects.toThrow(
			"Database unavailable",
		);
		expect(mocks.send).not.toHaveBeenCalled();
	});

	it("saves every pending recurring booking before announcing confirmation", async () => {
		mocks.findMany.mockResolvedValue([
			{ id: 2, uid: "first", status: BookingStatus.PENDING },
			{ id: 3, uid: "second", status: BookingStatus.PENDING },
		]);
		await handleConfirmation({ ...fixture(), recurringEventId: "series" });
		expect(mocks.update).toHaveBeenCalledTimes(2);
		expect(mocks.send).toHaveBeenCalledTimes(1);
		expect(mocks.update.mock.invocationCallOrder[1]).toBeLessThan(
			mocks.send.mock.invocationCallOrder[0],
		);
	});
});
