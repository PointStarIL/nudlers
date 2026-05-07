/**
 * Messaging provider contract.
 *
 * @typedef {'daily_summary' | 'restart_notify' | 'test'} MessagePurpose
 *
 * @typedef {Object} MessagingSettings
 *  Snapshot of all messaging-relevant rows from app_settings, parsed to JS
 *  values. The dispatcher loads this once per send and hands it to every
 *  provider — providers must not re-read app_settings on their own.
 *
 * @typedef {Object} ProviderSendResult
 * @property {boolean} success           At least one recipient was reached.
 * @property {number} [sent]             How many recipients actually accepted.
 * @property {number} [total]            How many recipients were attempted.
 * @property {Array<Object>} [results]   Per-recipient detail.
 *
 * @typedef {Object} MessagingProvider
 * @property {string} id                                    Stable identifier ('whatsapp', 'telegram', ...).
 * @property {(purpose: MessagePurpose, s: MessagingSettings) => boolean} isEnabled
 *   Returns true iff this provider is fully configured AND the user has
 *   opted in for `purpose`. Cheap, synchronous, no I/O.
 * @property {(args: { body: string, purpose: MessagePurpose }, s: MessagingSettings) => Promise<ProviderSendResult>} send
 *   Throws iff the message could not be delivered to any recipient.
 *   Per-recipient partial failures should be reported in `results`, not thrown.
 */
export {};
