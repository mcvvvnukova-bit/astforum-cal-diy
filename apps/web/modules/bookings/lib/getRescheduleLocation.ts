export function getRescheduleLocation(
  location: string | null,
  responseLocation: unknown
): string | undefined {
  if (
    !responseLocation ||
    typeof responseLocation !== "object" ||
    !("optionValue" in responseLocation) ||
    typeof responseLocation.optionValue !== "string"
  ) {
    return undefined;
  }

  // An unchanged provider must keep its generated URL instead of the generic location hint.
  if (responseLocation.optionValue === location) return undefined;

  return responseLocation.optionValue;
}
