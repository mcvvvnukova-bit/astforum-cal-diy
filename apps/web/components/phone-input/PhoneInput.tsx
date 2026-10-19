"use client";

import { isSupportedCountry } from "libphonenumber-js";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";

import { useIsPlatform } from "@calcom/atoms/hooks/useIsPlatform";
import { type CountryCode, useBookerStore } from "@calcom/features/bookings/Booker/store";
import { trpc } from "@calcom/trpc/react";
import classNames from "@calcom/ui/classNames";
import { CUSTOM_PHONE_MASKS } from "./phone-masks";

export type PhoneInputProps = {
  value?: string;
  id?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
  name?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  defaultCountry?: string;
  inputStyle?: CSSProperties;
  flagButtonStyle?: CSSProperties;
  fixedCountry?: "ru";
};

const RUSSIAN_COUNTRY: string[] = ["ru"];

const getPhoneValue = (value: string | undefined, fixedCountry?: "ru"): string | undefined => {
  if (!value) return undefined;

  const normalized = value.trim().replace(/^\+?/, "+");
  if (fixedCountry === "ru" && !normalized.startsWith("+7")) return "+7";

  return normalized;
};

const getChangedPhoneValue = (value: string, fixedCountry?: "ru"): string => {
  let normalized = value;
  if (!normalized.startsWith("+")) normalized = `+${normalized}`;
  if (fixedCountry === "ru" && !normalized.startsWith("+7")) return "+7";

  return normalized;
};

const getOnlyCountries = (fixedCountry?: "ru"): string[] | undefined => {
  if (!fixedCountry) return undefined;
  return RUSSIAN_COUNTRY;
};

function BasePhoneInput({
  name,
  className = "",
  onChange,
  value,
  defaultCountry = "us",
  fixedCountry,
  ...rest
}: PhoneInputProps): JSX.Element {
  const isPlatform = useIsPlatform();
  const defaultPhoneCountryFromStore = useBookerStore((state) => state.defaultPhoneCountry);
  const effectiveDefaultCountry = defaultPhoneCountryFromStore || defaultCountry;
  const country = fixedCountry ?? effectiveDefaultCountry;

  // This is to trigger validation on prefill value changes
  useEffect(() => {
    if (!value) return;

    const sanitized = value
      .trim()
      .replace(/[^\d+]/g, "")
      .replace(/^\+?/, "+");

    if (sanitized === "+" || sanitized === "") return;

    if (value !== sanitized) {
      onChange(sanitized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (fixedCountry !== "ru" || !value) return;

    const sanitized = value
      .trim()
      .replace(/[^\d+]/g, "")
      .replace(/^\+?/, "+");

    if (sanitized !== "+" && !sanitized.startsWith("+7")) onChange("+7");
  }, [fixedCountry, onChange, value]);

  if (!isPlatform) {
    return (
      <BasePhoneInputWeb
        name={name}
        className={className}
        onChange={onChange}
        value={value}
        fixedCountry={fixedCountry}
        {...rest}
      />
    );
  }

  return (
    <PhoneInput
      {...rest}
      value={getPhoneValue(value, fixedCountry)}
      enableSearch={!fixedCountry}
      disableSearchIcon
      country={country}
      onlyCountries={getOnlyCountries(fixedCountry)}
      disableDropdown={!!fixedCountry}
      countryCodeEditable={!fixedCountry}
      disableCountryGuess={!!fixedCountry}
      masks={CUSTOM_PHONE_MASKS}
      inputProps={{
        name,
        required: rest.required,
        placeholder: rest.placeholder,
        autoComplete: "tel",
      }}
      onChange={(val: string): void => {
        onChange(getChangedPhoneValue(val, fixedCountry));
      }}
      containerClass={classNames(
        "hover:border-emphasis focus-within:border-emphasis border-default !bg-default rounded-md border focus-within:outline-none focus-within:ring-0 focus-within:ring-brand-default disabled:cursor-not-allowed",
        className
      )}
      inputClass="text-sm focus:ring-0 !bg-default text-default placeholder:text-muted"
      buttonClass="text-emphasis !bg-default"
      searchClass="!text-default !bg-default"
      dropdownClass="!text-default !bg-default"
      inputStyle={{ width: "inherit", border: 0 }}
      searchStyle={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        padding: "6px 12px",
        gap: "8px",
        width: "296px",
        height: "28px",
        marginLeft: "-4px",
      }}
      dropdownStyle={{ width: "max-content" }}
    />
  );
}

function BasePhoneInputWeb({
  name,
  className = "",
  onChange,
  value,
  inputStyle,
  flagButtonStyle,
  fixedCountry,
  ...rest
}: Omit<PhoneInputProps, "defaultCountry">): JSX.Element {
  const defaultCountry = useDefaultCountry();
  const country = fixedCountry ?? defaultCountry;

  return (
    <PhoneInput
      {...rest}
      value={getPhoneValue(value, fixedCountry)}
      // react-phone-input-2 treats `country` as a fallback. Keeping it stable
      // preserves calling-code-only values like `+371` during async updates,
      // while full international numbers still resolve their country from `value`.
      country={country}
      onlyCountries={getOnlyCountries(fixedCountry)}
      disableDropdown={!!fixedCountry}
      countryCodeEditable={!fixedCountry}
      disableCountryGuess={!!fixedCountry}
      enableSearch={!fixedCountry}
      disableSearchIcon
      masks={CUSTOM_PHONE_MASKS}
      inputProps={{
        name,
        required: rest.required,
        placeholder: rest.placeholder,
        autoComplete: "tel",
      }}
      onChange={(val: string): void => {
        onChange(getChangedPhoneValue(val, fixedCountry));
      }}
      containerClass={classNames(
        "hover:border-emphasis focus-within:border-emphasis border-default !bg-default rounded-md border focus-within:outline-none focus-within:ring-0 focus-within:ring-brand-default disabled:cursor-not-allowed",
        className
      )}
      inputClass="text-sm focus:ring-0 !bg-default text-default placeholder:text-muted"
      buttonClass="text-emphasis !bg-default"
      buttonStyle={{ ...flagButtonStyle }}
      searchClass="!text-default !bg-default"
      dropdownClass="!text-default !bg-default"
      inputStyle={{ width: "inherit", border: 0, ...inputStyle }}
      searchStyle={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        padding: "6px 12px",
        gap: "8px",
        width: "296px",
        height: "28px",
        marginLeft: "-4px",
      }}
      dropdownStyle={{ width: "max-content" }}
    />
  );
}

const useDefaultCountry = (): CountryCode => {
  const defaultPhoneCountryFromStore = useBookerStore((state) => state.defaultPhoneCountry);
  const [defaultCountry, setDefaultCountry] = useState<CountryCode>(defaultPhoneCountryFromStore || "us");
  const query = trpc.viewer.public.countryCode.useQuery(undefined, {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  useEffect(
    function refactorMeWithoutEffect() {
      if (defaultPhoneCountryFromStore) {
        setDefaultCountry(defaultPhoneCountryFromStore);
        return;
      }

      const data = query.data;
      if (!data?.countryCode) {
        return;
      }

      if (isSupportedCountry(data?.countryCode)) {
        setDefaultCountry(data.countryCode.toLowerCase() as CountryCode);
      } else {
        const navCountry = navigator.language.split("-")[1]?.toUpperCase();
        if (navCountry && isSupportedCountry(navCountry)) {
          setDefaultCountry(navCountry.toLowerCase() as CountryCode);
        } else {
          setDefaultCountry("us");
        }
      }
    },
    [query.data, defaultPhoneCountryFromStore]
  );

  return defaultCountry;
};

export default BasePhoneInput;
