import type { IntegrationModule } from "../core/types.js";
import calendarEmail from "./calendar-email.js";
import coreUtils from "./core-utils.js";
import files from "./files.js";
import homeAssistant from "./home-assistant.js";
import homeServer from "./home-server.js";
import media from "./media.js";
import notesMemory from "./notes-memory.js";
import { notifications, operations } from "./notifications-ops.js";
import tasks from "./tasks-reminders.js";
import web from "./web.js";

/** The reviewed, bundled catalogue. Adding an integration means adding a module here; nothing is downloaded at runtime. */
export const BUILTIN_MODULES: IntegrationModule[] = [coreUtils, tasks, notesMemory, files, web, homeServer, homeAssistant, calendarEmail, media, notifications, operations];
