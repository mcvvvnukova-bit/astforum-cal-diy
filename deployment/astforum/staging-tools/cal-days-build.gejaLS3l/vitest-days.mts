import { mergeConfig } from "vitest/config";
import base from "./vitest.config.mts";
export default mergeConfig(base, {
  resolve: { alias: [{ find: "~", replacement: "/calcom/apps/web/modules" }] },
  test: { maxWorkers: 1, fileParallelism: false, passWithNoTests: false },
});
