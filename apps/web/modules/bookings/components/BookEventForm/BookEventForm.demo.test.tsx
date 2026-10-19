/**
 * @vitest-environment jsdom
 */

import { render, screen, waitFor } from "@calcom/features/bookings/Booker/__tests__/test-utils";
import { WEBSITE_PRIVACY_POLICY_URL, WEBSITE_TERMS_URL } from "@calcom/lib/constants";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { fireEvent } from "@testing-library/react";
import { type ComponentProps, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookEventForm } from "./BookEventForm";
import { BookingFields } from "./BookingFields";

const { boundaryState }: { boundaryState: { isEmbed: boolean; language: string } } = vi.hoisted(() => ({
  boundaryState: {
    isEmbed: false,
    language: "ru",
  },
}));

vi.mock("@calcom/embed-core/embed-iframe", () => ({
  useIsEmbed: () => boundaryState.isEmbed,
}));

vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      public: {
        countryCode: {
          useQuery: () => ({ data: { countryCode: "US" } }),
        },
        timezones: {
          cityTimezones: {
            useQuery: () => ({ data: [], isPending: false }),
          },
        },
      },
    },
  },
}));

vi.mock("@calcom/lib/hooks/useLocale", async () => {
  const { default: en } = await import("@calcom/i18n/locales/en/common.json");
  const { default: ru } = await import("@calcom/i18n/locales/ru/common.json");
  const resources: { en: typeof en; ru: typeof ru } = { en, ru };

  return {
    useLocale: () => ({
      t: (key: string, values?: Record<string, string | number>) => {
        const messages = resources[boundaryState.language as keyof typeof resources];
        const translation = (messages as Record<string, unknown>)[key];
        let message = key;
        if (typeof translation === "string") message = translation;
        for (const [name, value] of Object.entries(values ?? {})) {
          message = message.replaceAll(`{{${name}}}`, String(value));
        }
        return message;
      },
      i18n: { language: boundaryState.language },
      isLocaleReady: true,
    }),
  };
});

vi.mock("@formkit/auto-animate/react", () => ({
  useAutoAnimate: () => [null],
}));

type BookingFieldsProps = ComponentProps<typeof BookingFields>;

const phoneFields = [
  {
    name: "attendeePhoneNumber",
    type: "phone",
    label: "Phone",
    placeholder: "Phone",
    required: true,
    editable: "system",
  },
] as BookingFieldsProps["fields"];

const BookingFieldsHarness = ({
  fields = phoneFields,
}: {
  fields?: BookingFieldsProps["fields"];
}): JSX.Element => {
  const form = useForm({
    defaultValues: {
      responses: {
        attendeePhoneNumber: "",
      },
    },
  });
  const [showFields, setShowFields] = useState(true);

  return (
    <FormProvider {...form}>
      <button type="button" onClick={(): void => setShowFields((visible) => !visible)}>
        Toggle step
      </button>
      {showFields ? (
        <BookingFields fields={fields} locations={[]} isDynamicGroupBooking={false} bookingData={null} />
      ) : null}
    </FormProvider>
  );
};

const renderPhoneFields = ({
  isEmbed,
  username = "demo",
  eventSlug = "60min",
  state = "booking",
}: {
  isEmbed: boolean;
  username?: string;
  eventSlug?: string;
  state?: "booking" | "selecting_date";
}): ReturnType<typeof render> => {
  boundaryState.isEmbed = isEmbed;
  return render(
    <TooltipProvider>
      <BookingFieldsHarness />
    </TooltipProvider>,
    {
      mockStore: {
        username,
        eventSlug,
        state,
        defaultPhoneCountry: "us",
      },
    }
  );
};

const getPhoneInput = async (container: HTMLElement): Promise<HTMLInputElement> => {
  await waitFor(() => {
    expect(container.querySelector('input[name="attendeePhoneNumber"]')).not.toBeNull();
  });
  return container.querySelector('input[name="attendeePhoneNumber"]') as HTMLInputElement;
};

describe("demo booking phone presentation", () => {
  beforeEach(() => {
    boundaryState.isEmbed = false;
    boundaryState.language = "ru";
  });

  it("locks the target booking phone to Russia and preserves its value across step navigation", async () => {
    const { container } = renderPhoneFields({ isEmbed: true });
    const phone = await getPhoneInput(container);

    expect(container.querySelector(".flag.ru")).not.toBeNull();
    expect(container.querySelector(".selected-flag .arrow")).toBeNull();
    expect(phone.value.replace(/\D/g, "")).toBe("7");
    const selectedFlag = container.querySelector(".selected-flag");
    expect(selectedFlag).not.toBeNull();
    if (!selectedFlag) throw new Error("Expected the selected country control");
    fireEvent.click(selectedFlag);
    expect(container.querySelector(".country-list")).toBeNull();
    expect(screen.queryByText("number_in_international_format")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Пожалуйста, введите номер в международном формате.")
    ).not.toBeInTheDocument();

    fireEvent.change(phone, { target: { value: "+79991234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Toggle step" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle step" }));

    const restoredPhone = await getPhoneInput(container);
    expect(restoredPhone.value.replace(/\D/g, "")).toBe("79991234567");
    expect(restoredPhone).toHaveAttribute("name", "attendeePhoneNumber");
    expect(restoredPhone).toBeRequired();
  });

  it("protects the fixed Russian prefix from deletion and rejects a pasted foreign calling code", async () => {
    const { container } = renderPhoneFields({ isEmbed: true });
    const phone = await getPhoneInput(container);

    fireEvent.change(phone, { target: { value: "" } });
    expect(phone.value.replace(/\D/g, "")).toBe("7");

    fireEvent.change(phone, { target: { value: "+12025550123" } });
    expect(phone.value.replace(/\D/g, "")).toBe("7");
  });

  it.each([
    { label: "the same non-embedded event", isEmbed: false, eventSlug: "60min" },
    { label: "another embedded event", isEmbed: true, eventSlug: "30min" },
  ])("preserves the international phone picker for $label", async ({ isEmbed, eventSlug }) => {
    const { container } = renderPhoneFields({ isEmbed, eventSlug });
    const phone = await getPhoneInput(container);

    expect(container.querySelector(".flag.us")).not.toBeNull();
    expect(container.querySelector(".selected-flag .arrow")).not.toBeNull();
    expect(screen.getByLabelText("Пожалуйста, введите номер в международном формате.")).toBeInTheDocument();

    const selectedFlag = container.querySelector(".selected-flag");
    expect(selectedFlag).not.toBeNull();
    if (!selectedFlag) throw new Error("Expected the selected country control");
    fireEvent.click(selectedFlag);
    expect(container.querySelector(".country-list")).not.toBeNull();
    fireEvent.change(phone, { target: { value: "+442079460018" } });
    expect(phone.value.replace(/\D/g, "")).toBe("442079460018");
  });
});

type BookEventFormProps = ComponentProps<typeof BookEventForm>;

const BookEventFormHarness = ({
  classNames,
  confirmButtonDisabled = false,
  loadingStates = { creatingBooking: false, creatingRecurringBooking: false },
}: {
  classNames?: BookEventFormProps["classNames"];
  confirmButtonDisabled?: boolean;
  loadingStates?: BookEventFormProps["loadingStates"];
}): JSX.Element => {
  const form = useForm({
    defaultValues: {
      responses: {},
      globalError: undefined,
      cfToken: "",
    },
  });

  return (
    <BookEventForm
      eventQuery={{
        isError: false,
        isPending: false,
        data: {
          price: 0,
          currency: "USD",
          metadata: {},
          bookingFields: [] as unknown as BookingFieldsProps["fields"],
          locations: [],
        },
      }}
      onCancel={vi.fn()}
      onSubmit={vi.fn()}
      errorRef={{ current: null }}
      errors={{
        hasFormErrors: false,
        formErrors: undefined,
        hasDataErrors: false,
        dataErrors: undefined,
      }}
      loadingStates={loadingStates}
      bookingForm={form as BookEventFormProps["bookingForm"]}
      renderConfirmNotVerifyEmailButtonCond={true}
      extraOptions={{}}
      isVerificationCodeSending={false}
      isTimeslotUnavailable={false}
      confirmButtonDisabled={confirmButtonDisabled}
      classNames={classNames}
      timeslot="2026-09-08T09:00:00.000Z"
    />
  );
};

describe("demo booking agreement", () => {
  it("uses the RU agreement without the product suffix and keeps both legal destinations", () => {
    boundaryState.isEmbed = true;
    boundaryState.language = "ru";

    render(<BookEventFormHarness />, {
      mockStore: { username: "demo", eventSlug: "60min", state: "booking", timezone: "Europe/Moscow" },
    });

    const terms = screen.getByRole("link", { name: "условиями использования" });
    const privacy = screen.getByRole("link", { name: "политикой конфиденциальности" });
    const agreement = terms.parentElement;
    expect(agreement).not.toBeNull();
    if (!agreement) throw new Error("Expected the agreement container");

    expect(agreement.textContent).not.toContain("Cal.diy");
    expect(agreement.textContent).toBe(
      "Продолжая, вы соглашаетесь с условиями использования и политикой конфиденциальности."
    );
    expect(terms).toHaveAttribute("href", WEBSITE_TERMS_URL);
    expect(privacy).toHaveAttribute("href", WEBSITE_PRIVACY_POLICY_URL);
  });
});

describe("demo booking primary action presentation", () => {
  beforeEach(() => {
    boundaryState.isEmbed = true;
    boundaryState.language = "ru";
  });

  it("adds the scoped action class to the target confirmation while preserving the caller class", () => {
    render(
      <BookEventFormHarness classNames={{ confirmButton: "caller-confirm", backButton: "caller-back" }} />,
      { mockStore: { username: "demo", eventSlug: "60min", state: "booking", timezone: "Europe/Moscow" } }
    );

    const confirm = screen.getByTestId("confirm-book-button");
    expect(confirm).toHaveClass("caller-confirm");
    expect(confirm.className).toMatch(/primaryAction/);
    expect(screen.getByTestId("back")).toHaveClass("caller-back");
    expect(screen.getByTestId("back").className).not.toMatch(/primaryAction/);
  });

  it.each([
    { label: "the direct target event", isEmbed: false, username: "demo", eventSlug: "60min" },
    { label: "another embedded event", isEmbed: true, username: "demo", eventSlug: "30min" },
    { label: "another embedded username", isEmbed: true, username: "other", eventSlug: "60min" },
  ])("does not add the scoped action class for $label", ({ isEmbed, username, eventSlug }) => {
    boundaryState.isEmbed = isEmbed;

    render(<BookEventFormHarness />, {
      mockStore: { username, eventSlug, state: "booking", timezone: "Europe/Moscow" },
    });

    expect(screen.getByTestId("confirm-book-button").className).not.toMatch(/primaryAction/);
  });

  it("keeps the target confirmation disabled while applying the scoped action class", () => {
    render(<BookEventFormHarness classNames={{ confirmButton: "caller-confirm" }} confirmButtonDisabled />, {
      mockStore: { username: "demo", eventSlug: "60min", state: "booking", timezone: "Europe/Moscow" },
    });

    const confirm = screen.getByTestId("confirm-book-button");
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveClass("caller-confirm");
    expect(confirm.className).toMatch(/primaryAction/);
    expect(confirm.querySelector("svg.animate-spin")).not.toBeInTheDocument();
  });

  it("shows a loading spinner for the target confirmation while applying the scoped action class", () => {
    render(
      <BookEventFormHarness
        classNames={{ confirmButton: "caller-confirm" }}
        loadingStates={{ creatingBooking: true, creatingRecurringBooking: false }}
      />,
      { mockStore: { username: "demo", eventSlug: "60min", state: "booking", timezone: "Europe/Moscow" } }
    );

    const confirm = screen.getByTestId("confirm-book-button");
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveClass("caller-confirm");
    expect(confirm.className).toMatch(/primaryAction/);
    expect(confirm.querySelector("svg.animate-spin")).toBeInTheDocument();
  });
});
