import { registerCapability } from "./types.js";
import { memoryCapability } from "./memory.js";
import { calendarCapability } from "./calendar.js";
import { remindersCapability } from "./reminders.js";
import { webSearchCapability } from "./webSearch.js";
import { filesCapability } from "./files.js";
import { notesCapability } from "./notes.js";
import { tasksCapability } from "./tasks.js";
import { weatherCapability } from "./weather.js";
import { timerCapability } from "./timer.js";
import { calculatorCapability } from "./calculator.js";
import { systemMonitorCapability } from "./systemMonitor.js";
import { dockerCapability } from "./docker.js";
import { networkCapability } from "./network.js";
import { codeAssistantCapability } from "./codeAssistant.js";
import { automationCapability } from "./automation.js";
import { timezoneCapability } from "./timezone.js";
import { capabilityRegistry } from "./types.js";

export function registerAllCapabilities() {
  registerCapability(memoryCapability);
  registerCapability(calendarCapability);
  registerCapability(remindersCapability);
  registerCapability(webSearchCapability);
  registerCapability(filesCapability);
  registerCapability(notesCapability);
  registerCapability(tasksCapability);
  registerCapability(weatherCapability);
  registerCapability(timerCapability);
  registerCapability(calculatorCapability);
  registerCapability(systemMonitorCapability);
  registerCapability(dockerCapability);
  registerCapability(networkCapability);
  registerCapability(codeAssistantCapability);
  registerCapability(automationCapability);
  registerCapability(timezoneCapability);
}

/**
 * Validate registered capabilities for common issues.
 * Returns an array of warning messages, or empty if all is well.
 */
export function validateCapabilities(): string[] {
  const errors: string[] = [];

  // Check no capabilities registered
  if (capabilityRegistry.size === 0) {
    errors.push("No capabilities registered");
    return errors;
  }

  // Check each capability
  for (const [name, capability] of capabilityRegistry) {
    // Verify capability has at least one action
    if (!capability.actions || capability.actions.length === 0) {
      errors.push(`Capability "${name}" has no actions`);
      continue;
    }

    // Verify each action has required fields
    for (const action of capability.actions) {
      if (!action.name || action.name.trim().length === 0) {
        errors.push(`Capability "${name}" has an action with no name`);
      }
      if (!action.description || action.description.trim().length === 0) {
        errors.push(`Capability "${name}" action "${action.name}" has no description`);
      }
      if (!action.inputSchema) {
        errors.push(`Capability "${name}" action "${action.name}" has no inputSchema`);
      }
      if (!action.execute || typeof action.execute !== "function") {
        errors.push(`Capability "${name}" action "${action.name}" has no execute function`);
      }
    }
  }

  return errors;
}
