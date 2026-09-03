import { z } from "zod";
import { Capability, CapabilityResult } from "./types.js";

export const timezoneCapability: Capability = {
  name: "timezone",
  description: "View the current time in any timezone and convert between timezones.",
  actions: [
    {
      name: "timezone_get_time",
      description: "Get the current time in a specific timezone.",
      permission: "read",
      inputSchema: z.object({
        timezone: z.string().describe("IANA timezone identifier, e.g. 'America/New_York', 'Europe/London', 'Asia/Tokyo'"),
      }),
      execute: async (input): Promise<CapabilityResult> => {
        try {
          const { timezone } = input as { timezone: string };

          // Validate timezone by attempting to format a date
          const testDate = new Date();
          const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          });

          const parts = formatter.formatToParts(testDate);
          const timeString = parts.map((p) => p.value).join("");

          // More detailed format for the response
          const detailedFormatter = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          });

          const formattedTime = detailedFormatter.format(testDate);

          // Calculate current UTC offset
          const utcDate = new Date(testDate.toLocaleString("en-US", { timeZone: "UTC" }));
          const tzDate = new Date(testDate.toLocaleString("en-US", { timeZone: timezone }));
          const offsetMs = tzDate.getTime() - utcDate.getTime();
          const offsetHours = Math.round(offsetMs / (1000 * 60 * 60));
          const offsetSign = offsetHours >= 0 ? "+" : "";
          const offsetString = `UTC${offsetSign}${offsetHours}`;

          return {
            ok: true,
            summary: `${timezone}: ${formattedTime} (${offsetString})`,
            data: {
              timezone,
              currentTime: formattedTime,
              utcOffset: offsetString,
              isoTime: testDate.toISOString(),
            },
          };
        } catch (err) {
          return {
            ok: false,
            summary: `Unknown timezone "${(input as { timezone: string }).timezone}". Use IANA format like "America/New_York".`,
            error: "unknown_timezone",
          };
        }
      },
    },
    {
      name: "timezone_convert",
      description: "Convert a time from one timezone to another.",
      permission: "read",
      inputSchema: z.object({
        time: z.string().describe("Time in ISO format or as a time string like '14:30'"),
        fromTimezone: z.string().describe("Source timezone in IANA format, e.g. 'America/Los_Angeles'"),
        toTimezone: z.string().describe("Target timezone in IANA format, e.g. 'Europe/London'"),
      }),
      execute: async (input): Promise<CapabilityResult> => {
        try {
          const { time, fromTimezone, toTimezone } = input as { time: string; fromTimezone: string; toTimezone: string };

          let sourceDate: Date;
          if (time.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
            // ISO format
            sourceDate = new Date(time);
          } else if (time.match(/^\d{1,2}:\d{2}/)) {
            // Time only - use today's date
            sourceDate = new Date();
            const [hours, minutes] = time.split(":").map(Number);
            sourceDate.setHours(hours, minutes, 0, 0);
          } else {
            return {
              ok: false,
              summary: `Invalid time format. Use ISO format (2024-01-15T14:30:00) or time only (14:30).`,
              error: "invalid_time_format",
            };
          }

          // Validate timezones
          try {
            new Intl.DateTimeFormat("en-US", { timeZone: fromTimezone }).format(sourceDate);
            new Intl.DateTimeFormat("en-US", { timeZone: toTimezone }).format(sourceDate);
          } catch {
            return {
              ok: false,
              summary: `Invalid timezone. Check that both "${fromTimezone}" and "${toTimezone}" are valid IANA timezone identifiers.`,
              error: "invalid_timezone",
            };
          }

          const fromFormatter = new Intl.DateTimeFormat("en-US", {
            timeZone: fromTimezone,
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          });

          const toFormatter = new Intl.DateTimeFormat("en-US", {
            timeZone: toTimezone,
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          });

          return {
            ok: true,
            summary: `${time} in ${fromTimezone} is ${toFormatter.format(sourceDate)} in ${toTimezone}`,
            data: {
              sourceTime: fromFormatter.format(sourceDate),
              sourceTimezone: fromTimezone,
              convertedTime: toFormatter.format(sourceDate),
              targetTimezone: toTimezone,
            },
          };
        } catch (err) {
          return {
            ok: false,
            summary: `Timezone conversion failed: ${String(err)}`,
            error: "conversion_failed",
          };
        }
      },
    },
    {
      name: "timezone_list_common",
      description: "List common timezones for reference.",
      permission: "read",
      inputSchema: z.object({}),
      execute: async (): Promise<CapabilityResult> => {
        const commonTimezones = [
          { tz: "Europe/London", label: "London (GMT/BST)" },
          { tz: "Europe/Paris", label: "Paris (CET/CEST)" },
          { tz: "Europe/Berlin", label: "Berlin (CET/CEST)" },
          { tz: "America/New_York", label: "New York (EST/EDT)" },
          { tz: "America/Chicago", label: "Chicago (CST/CDT)" },
          { tz: "America/Denver", label: "Denver (MST/MDT)" },
          { tz: "America/Los_Angeles", label: "Los Angeles (PST/PDT)" },
          { tz: "Asia/Tokyo", label: "Tokyo (JST)" },
          { tz: "Asia/Shanghai", label: "Shanghai (CST)" },
          { tz: "Asia/Hong_Kong", label: "Hong Kong (HKT)" },
          { tz: "Asia/Singapore", label: "Singapore (SGT)" },
          { tz: "Asia/Dubai", label: "Dubai (GST)" },
          { tz: "Asia/Kolkata", label: "India (IST)" },
          { tz: "Australia/Sydney", label: "Sydney (AEDT/AEST)" },
          { tz: "Pacific/Auckland", label: "Auckland (NZDT/NZST)" },
          { tz: "UTC", label: "UTC (Coordinated Universal Time)" },
        ];

        return {
          ok: true,
          summary: `Available timezone list (${commonTimezones.length} common timezones).`,
          data: commonTimezones,
        };
      },
    },
  ],
};
