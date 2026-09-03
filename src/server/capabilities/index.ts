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
}
