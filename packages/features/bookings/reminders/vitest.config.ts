import { resolve } from "node:path";
export default {
  resolve: {
    alias: {
      "app/api/defaultResponderForAppDir": resolve(
        import.meta.dirname,
        "../../../../apps/web/app/api/defaultResponderForAppDir.ts"
      ),
    },
  },
  test: {
    environment: "node",
    include: ["packages/features/bookings/reminders/*.test.ts"],
    testTimeout: 10000,
  },
};
