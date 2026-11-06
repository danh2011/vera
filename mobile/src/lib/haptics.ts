import * as Haptics from "expo-haptics";

let enabled = true;
export const setHapticsEnabled = (v: boolean) => { enabled = v; };
const run = (fn: () => Promise<void>) => { if (enabled) fn().catch(() => {}); };
export const haptic = {
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  select: () => run(() => Haptics.selectionAsync()),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warn: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
