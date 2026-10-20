import { setTimeout as delay } from "node:timers/promises";

// ======================================================
// EXPO PUSH CONFIGURATION
// ======================================================

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

const REQUEST_TIMEOUT_MS = 15000;
const MAX_BATCH_SIZE = 100;

// ======================================================
// EXPO PUSH TOKEN VALIDATION
// ======================================================

export const isExpoPushToken = (token) => {
  if (typeof token !== "string") {
    return false;
  }

  return /^(ExpoPushToken|ExponentPushToken)\[[^\]\s]+\]$/.test(token.trim());
};

// ======================================================
// HTTP REQUEST HELPER
// ======================================================

const expoRequest = async (url, payload) => {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const result = await response.json();

    if (!response.ok) {
      const message =
        result?.errors?.[0]?.message ||
        `Expo request failed with status ${response.status}`;

      const error = new Error(message);
      error.statusCode = response.status;

      throw error;
    }

    return result;
  } finally {
    clearTimeout(timeout);
  }
};

// ======================================================
// BUILD PUSH MESSAGE
// ======================================================

const buildPushMessage = ({ token, title, body, data = {} }) => ({
  to: token,
  sound: "default",
  title,
  body,
  data,
  priority: "high",
});

// ======================================================
// SEND SINGLE PUSH NOTIFICATION
// ======================================================

export const sendPushNotification = async ({
  token,
  title,
  body,
  data = {},
}) => {
  if (!isExpoPushToken(token)) {
    return {
      success: false,
      reason: "INVALID_PUSH_TOKEN",
      token,
    };
  }

  try {
    const result = await expoRequest(
      EXPO_PUSH_URL,
      buildPushMessage({ token, title, body, data }),
    );

    const ticket = Array.isArray(result.data) ? result.data[0] : result.data;

    if (!ticket) {
      return {
        success: false,
        reason: "NO_PUSH_TICKET",
        token,
      };
    }

    if (ticket.status === "error") {
      return {
        success: false,
        reason: ticket.details?.error || "EXPO_REJECTED_PUSH",
        error: ticket.message || "Expo rejected the push notification",
        ticket,
        token,
      };
    }

    if (ticket.status !== "ok") {
      return {
        success: false,
        reason: "UNKNOWN_PUSH_TICKET_STATUS",
        ticket,
        token,
      };
    }

    return {
      success: true,
      reason: "EXPO_TICKET_ACCEPTED",
      ticketId: ticket.id ?? null,
      ticket,
      token,
    };
  } catch (error) {
    return {
      success: false,
      reason:
        error.name === "AbortError"
          ? "PUSH_REQUEST_TIMEOUT"
          : "PUSH_REQUEST_ERROR",
      error: error.message,
      token,
    };
  }
};

// ======================================================
// SEND PUSH NOTIFICATIONS TO USER
// ======================================================

export const sendPushToUser = async ({ tokens, title, body, data = {} }) => {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return [];
  }

  const uniqueTokens = [
    ...new Set(tokens.filter(isExpoPushToken).map((token) => token.trim())),
  ];

  if (uniqueTokens.length === 0) {
    return [];
  }

  const results = [];

  for (let index = 0; index < uniqueTokens.length; index += MAX_BATCH_SIZE) {
    const batch = uniqueTokens.slice(index, index + MAX_BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map((token) =>
        sendPushNotification({
          token,
          title,
          body,
          data,
        }),
      ),
    );

    results.push(...batchResults);
  }

  return results;
};

// ======================================================
// GET EXPO PUSH RECEIPTS
// ======================================================

export const getPushReceipts = async (ticketIds = []) => {
  if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
    return {};
  }

  const uniqueTicketIds = [
    ...new Set(
      ticketIds.filter((id) => typeof id === "string" && id.trim().length > 0),
    ),
  ];

  const receipts = {};

  for (let index = 0; index < uniqueTicketIds.length; index += MAX_BATCH_SIZE) {
    const batch = uniqueTicketIds.slice(index, index + MAX_BATCH_SIZE);

    const result = await expoRequest(EXPO_RECEIPTS_URL, {
      ids: batch,
    });

    Object.assign(receipts, result.data ?? {});
  }

  return receipts;
};

// ======================================================
// CHECK PUSH RECEIPT
// ======================================================

export const checkPushReceipt = async (ticketId) => {
  if (typeof ticketId !== "string" || !ticketId.trim()) {
    return {
      success: false,
      reason: "INVALID_TICKET_ID",
    };
  }

  try {
    const receipts = await getPushReceipts([ticketId]);
    const receipt = receipts[ticketId];

    if (!receipt) {
      return {
        success: false,
        pending: true,
        reason: "RECEIPT_NOT_AVAILABLE",
        ticketId,
      };
    }

    if (receipt.status === "error") {
      return {
        success: false,
        pending: false,
        reason: receipt.details?.error || "PUSH_DELIVERY_FAILED",
        error: receipt.message,
        receipt,
        ticketId,
      };
    }

    if (receipt.status !== "ok") {
      return {
        success: false,
        pending: true,
        reason: "UNKNOWN_RECEIPT_STATUS",
        receipt,
        ticketId,
      };
    }

    return {
      success: true,
      pending: false,
      reason: "PUSH_RECEIPT_OK",
      receipt,
      ticketId,
    };
  } catch (error) {
    return {
      success: false,
      pending: true,
      reason: "RECEIPT_CHECK_FAILED",
      error: error.message,
      ticketId,
    };
  }
};
