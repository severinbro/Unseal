// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  ApiError,
  CHAT_LIMITS,
  type AuthUser,
  type ChatMessage,
  type ChatThread,
  type PolygonFeature,
} from '@openunseal/shared';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Platform, Text, TextInput, View } from 'react-native';

import type { PpgisApiClient } from '../api/client';
import { getSocialCopy } from '../i18n/social';
import { getTranslations, localizeError, type Locale } from '../i18n/translations';
import { mergeMessages } from '../state/chatMessages';
import { firstUnreadIndex } from '../state/feedScope';
import { formatAreaDisplay } from '../state/viewModels';
import { SocialButton, SocialCheckbox, useSocialStyles } from './SocialUi';
import { groundLabel } from './SpaceSections';

export const CHAT_POLL_MS = 5_000;

export function isForeground(): boolean {
  if (Platform.OS === 'web') {
    const doc = (globalThis as { document?: { hidden?: boolean } }).document;
    return doc?.hidden !== true;
  }
  return AppState.currentState === 'active';
}

export interface ChatStart {
  /** Open a conversation with the author of this area. */
  contact?: PolygonFeature;
  /** Attach this area to the next message. */
  attachment?: PolygonFeature;
  /** Attach this comment (of `attachment`) to the next message. */
  comment?: { id: string };
}

interface Attachment {
  feature: PolygonFeature;
  commentId: string | null;
  /** Null while the person still has to choose whom to send it to. */
  threadId: string | null;
}

export function DirectChatModal(props: {
  locale: Locale;
  user: AuthUser;
  client: PpgisApiClient;
  start: ChatStart;
  retentionDays: number;
  resolveUploadUrl: (url: string) => string;
  onUserUpdated: (user: AuthUser) => void;
  onShowPolygon: (polygonId: string) => void;
  onReport: (messageId: string) => void;
  onError: (err: unknown) => Promise<boolean>;
  /** Asked after new messages arrived, so the newest one is in view. */
  onScrollToEnd?: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { styles, palette } = useSocialStyles();
  const { client, locale, onError } = props;
  const t = getSocialCopy(locale);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [active, setActive] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const afterRef = useRef<string | null>(null);
  const countRef = useRef(0);
  const activeIdRef = useRef<string | null>(null);
  const [draft, setDraftText] = useState('');
  // One draft per conversation: text typed for one person never follows the
  // reader into another conversation.
  const draftsRef = useRef(new Map<string, string>());
  const [recipient, setRecipient] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(
    props.start.attachment
      ? {
          feature: props.start.attachment,
          commentId: props.start.comment?.id ?? null,
          threadId: null,
        }
      : null,
  );
  const [unreadFromId, setUnreadFromId] = useState<string | null>(null);
  const [reportedThreadId, setReportedThreadId] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (action: () => Promise<void>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await action();
      } catch (err: unknown) {
        if (!(await onError(err))) {
          setError(localizeError(err, t.failed, locale));
        }
      } finally {
        setBusy(false);
      }
    },
    [onError, locale, t.failed],
  );

  const refreshThreads = useCallback(async (): Promise<void> => {
    setThreads(await client.listChats());
  }, [client]);

  const setDraft = (text: string): void => {
    setDraftText(text);
    if (activeIdRef.current !== null) {
      draftsRef.current.set(activeIdRef.current, text);
    }
  };

  /** `unreadBefore` marks where the unread messages start; undefined keeps the mark. */
  const loadThread = useCallback(
    async (threadId: string, unreadBefore?: number): Promise<void> => {
      const switching = activeIdRef.current !== threadId;
      activeIdRef.current = threadId;
      const page = await client.listChatMessages(threadId);
      if (activeIdRef.current !== threadId) {
        return;
      }
      setActive(page.thread);
      setMessages(page.messages);
      setOlderCursor(page.nextBeforeCursor);
      afterRef.current = page.nextAfterCursor;
      countRef.current = page.thread.messageCount;
      setConnectionLost(false);
      if (switching) {
        setDraftText(draftsRef.current.get(threadId) ?? '');
        setConfirmDelete(false);
      }
      if (unreadBefore !== undefined) {
        const index = firstUnreadIndex(page.messages, unreadBefore);
        setUnreadFromId(index >= 0 ? (page.messages[index]?.id ?? null) : null);
      }
    },
    [client],
  );

  useEffect(() => {
    void run(async () => {
      await refreshThreads();
      const contact = props.start.contact;
      if (contact) {
        const thread = await client.openChat({ polygonId: contact.id });
        // This reference belongs to this conversation only.
        setAttachment({ feature: contact, commentId: null, threadId: thread.id });
        await loadThread(thread.id, 0);
      }
    });
    // Runs once per opening of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newestId = messages[messages.length - 1]?.id ?? null;
  const { onScrollToEnd } = props;
  useEffect(() => {
    if (newestId !== null) {
      onScrollToEnd?.();
    }
  }, [newestId, onScrollToEnd]);

  const activeId = active?.id ?? null;
  useEffect(() => {
    if (activeId === null) {
      return;
    }
    const timer = setInterval(() => {
      if (!isForeground()) {
        return;
      }
      void (async () => {
        try {
          const after = afterRef.current;
          if (after === null) {
            await loadThread(activeId);
            return;
          }
          const page = await client.listChatMessages(activeId, { after });
          if (activeIdRef.current !== activeId) {
            return;
          }
          afterRef.current = page.nextAfterCursor ?? after;
          const expected = countRef.current + page.messages.length;
          countRef.current = page.thread.messageCount;
          setActive(page.thread);
          setConnectionLost(false);
          if (page.thread.messageCount < expected) {
            // Something was deleted: reload instead of showing stale text.
            await loadThread(activeId);
          } else if (page.messages.length > 0) {
            setMessages((prev) => mergeMessages(prev, page.messages));
          }
        } catch (err: unknown) {
          if ((await onError(err)) || activeIdRef.current !== activeId) {
            return;
          }
          // Only a conversation that is really gone is closed; a dropped
          // connection keeps what is on screen and tries again.
          if (
            err instanceof ApiError &&
            (err.statusCode === 404 || err.statusCode === 403)
          ) {
            activeIdRef.current = null;
            setActive(null);
            setMessages([]);
            await refreshThreads().catch(() => undefined);
          } else {
            setConnectionLost(true);
          }
        }
      })();
    }, CHAT_POLL_MS);
    return () => clearInterval(timer);
  }, [activeId, client, loadThread, onError, refreshThreads]);

  const name = (pseudonym: string): string =>
    pseudonym === 'deleted' ? t.deleted : pseudonym;

  const closeThread = (): void => {
    activeIdRef.current = null;
    setActive(null);
    setMessages([]);
    setDraftText('');
    setUnreadFromId(null);
    setConnectionLost(false);
    setConfirmDelete(false);
    void run(refreshThreads);
  };

  const attached =
    attachment !== null &&
    active !== null &&
    (attachment.threadId === null || attachment.threadId === active.id)
      ? attachment
      : null;

  const afterDeletion = async (threadId: string): Promise<void> => {
    try {
      await loadThread(threadId);
    } catch {
      closeThread();
    }
  };

  const send = (): void => {
    const body = draft.trim();
    if (!active || body.length === 0) {
      return;
    }
    void run(async () => {
      await client.sendChatMessage(active.id, {
        body,
        ...(attached
          ? attached.commentId
            ? { referencedCommentId: attached.commentId }
            : { referencedPolygonId: attached.feature.id }
          : {}),
      });
      setDraft('');
      if (attached) {
        setAttachment(null);
      }
      setUnreadFromId(null);
      await loadThread(active.id);
    });
  };

  const requests = threads.filter((thread) => thread.requestState === 'incoming');
  const conversations = threads.filter(
    (thread) => thread.requestState !== 'incoming',
  );
  const threadButton = (thread: ChatThread): React.JSX.Element => (
    <SocialButton
      key={thread.id}
      testID={`chat-thread-${thread.id}`}
      label={`${name(thread.counterpartPseudonym)}${
        thread.requestState === 'none' ? '' : ` · ${t.requestBadge}`
      }${thread.unreadCount > 0 ? ` (${thread.unreadCount})` : ''}${
        thread.lastMessagePreview ? `: ${thread.lastMessagePreview}` : ''
      }`}
      onPress={() => void run(() => loadThread(thread.id, thread.unreadCount))}
    />
  );

  return (
    <View style={styles.card} testID="direct-chat-modal">
      <View style={styles.spread}>
        <Text style={styles.title}>
          {active ? name(active.counterpartPseudonym) : t.chatTitle}
        </Text>
        <View style={styles.row}>
          {active ? <SocialButton label={t.back} onPress={closeThread} /> : null}
          <SocialButton testID="chat-close" label={t.close} onPress={props.onClose} />
        </View>
      </View>
      <Text style={styles.hint}>{t.chatNotice(props.retentionDays)}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {active === null ? (
        <>
          <SocialCheckbox
            testID="allow-direct-messages"
            label={t.allowDm}
            checked={props.user.allowDirectMessages}
            disabled={busy}
            onToggle={() =>
              void run(async () => {
                props.onUserUpdated(
                  await client.updatePreferences(!props.user.allowDirectMessages),
                );
              })
            }
          />
          <Text style={styles.hint}>{t.allowDmHint}</Text>
          <TextInput
            testID="chat-recipient"
            accessibilityLabel={t.startWith}
            placeholder={t.startWith}
            placeholderTextColor={palette.inkMuted}
            value={recipient}
            onChangeText={setRecipient}
            autoCapitalize="none"
            style={styles.input}
          />
          <SocialButton
            label={t.start}
            disabled={busy || recipient.trim().length < 3}
            onPress={() =>
              void run(async () => {
                const thread = await client.openChat({
                  recipientPseudonym: recipient.trim(),
                });
                setRecipient('');
                await loadThread(thread.id, 0);
              })
            }
          />
          {attachment !== null && attachment.threadId === null ? (
            <Text style={styles.hint}>{t.choosePerson}</Text>
          ) : null}
          {threads.length === 0 ? (
            <Text style={styles.body}>{busy ? t.loading : t.chatEmpty}</Text>
          ) : (
            <>
              {requests.length > 0 ? (
                <>
                  <Text style={styles.subtitle}>{t.requestsTitle}</Text>
                  {requests.map(threadButton)}
                  <Text style={styles.subtitle}>{t.conversationsTitle}</Text>
                </>
              ) : null}
              {conversations.map(threadButton)}
            </>
          )}
        </>
      ) : (
        <>
          {olderCursor ? (
            <SocialButton
              label={t.older}
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  const page = await client.listChatMessages(active.id, {
                    before: olderCursor,
                  });
                  setMessages((prev) => mergeMessages(prev, page.messages));
                  setOlderCursor(page.nextBeforeCursor);
                })
              }
            />
          ) : null}
          {active.requestState === 'incoming' ? (
            <View style={styles.notice} testID="chat-request-incoming">
              <Text style={styles.body}>
                {t.requestIncoming(
                  name(active.counterpartPseudonym),
                  CHAT_LIMITS.REQUEST_RETENTION_DAYS,
                )}
              </Text>
            </View>
          ) : null}
          {connectionLost ? <Text style={styles.hint}>{t.connectionLost}</Text> : null}
          {messages.map((message) => {
            const area = message.referencedPolygon;
            const comment = message.referencedComment;
            return (
              <React.Fragment key={message.id}>
              {message.id === unreadFromId ? (
                <Text style={styles.divider} testID="chat-unread-divider">
                  {t.newMessages}
                </Text>
              ) : null}
              <View
                style={[
                  styles.bubble,
                  message.isOwnMessage ? styles.bubbleOwn : styles.bubbleOther,
                ]}
              >
                <Text style={styles.body}>{message.body}</Text>
                {area ? (
                  <View style={styles.section}>
                    {area.thumbUrl ? (
                      <>
                        <Image
                          source={{ uri: props.resolveUploadUrl(area.thumbUrl) }}
                          style={styles.thumb}
                        />
                        <Text style={styles.hint}>
                          {t.photoBy(name(area.thumbUploaderPseudonym ?? 'deleted'))}
                        </Text>
                      </>
                    ) : null}
                    <Text style={styles.hint}>
                      {getTranslations(locale).surfaces[area.surfaceType].label} ·{' '}
                      {groundLabel(area.spaceType, t)} ·{' '}
                      {formatAreaDisplay(area.areaM2, locale)}
                    </Text>
                    <Text
                      style={styles.link}
                      accessibilityRole="link"
                      onPress={() => props.onShowPolygon(area.id)}
                    >
                      {t.showOnMap}
                    </Text>
                  </View>
                ) : null}
                {comment ? (
                  <Text style={styles.hint}>
                    „{comment.bodyExcerpt}“ - {t.commentBy(name(comment.authorPseudonym))}
                  </Text>
                ) : null}
                <Text style={styles.hint}>
                  {new Date(message.createdAt).toLocaleString(
                    locale === 'de' ? 'de-DE' : 'en-GB',
                  )}
                </Text>
                {message.isOwnMessage ? (
                  <Text
                    style={styles.link}
                    accessibilityRole="button"
                    onPress={() =>
                      void run(async () => {
                        await client.deleteChatMessages(active.id, message.id);
                        await afterDeletion(active.id);
                      })
                    }
                  >
                    {t.deleteOne}
                  </Text>
                ) : (
                  <Text
                    style={styles.link}
                    accessibilityRole="button"
                    onPress={() => {
                      setReportedThreadId(active.id);
                      props.onReport(message.id);
                    }}
                  >
                    {t.report}
                  </Text>
                )}
              </View>
              </React.Fragment>
            );
          })}
          {reportedThreadId === active.id && !active.isBlockedByMe ? (
            <View style={styles.notice} testID="chat-block-offer">
              <Text style={styles.body}>{t.reportedBlockOffer}</Text>
              <SocialButton
                label={t.block}
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    setActive(await client.setChatBlocked(active.id, true));
                  })
                }
              />
            </View>
          ) : null}
          {active.requestState === 'outgoing' ? (
            <Text style={styles.hint} testID="chat-request-outgoing">
              {t.requestOutgoing}
            </Text>
          ) : active.canSend ? (
            <>
              {active.requestState === 'none' && active.messageCount === 0 ? (
                <Text style={styles.hint}>{t.requestFirst}</Text>
              ) : null}
              {attached ? (
                <View style={styles.spread}>
                  <Text style={[styles.hint, styles.grow]}>
                    {attached.commentId ? t.attachedComment : t.attached}
                  </Text>
                  <SocialButton
                    label={t.removeAttachment}
                    onPress={() => setAttachment(null)}
                  />
                </View>
              ) : null}
              <TextInput
                testID="chat-input"
                accessibilityLabel={t.write}
                placeholder={t.write}
                placeholderTextColor={palette.inkMuted}
                value={draft}
                onChangeText={setDraft}
                maxLength={CHAT_LIMITS.MAX_MESSAGE_LENGTH}
                multiline
                style={styles.input}
              />
              <SocialButton
                testID="chat-send"
                label={t.send}
                primary
                disabled={busy || draft.trim().length === 0}
                onPress={send}
              />
            </>
          ) : (
            <Text style={styles.hint}>
              {active.isBlockedByMe ? t.blockedByYou : t.cannotSend}
            </Text>
          )}
          <View style={styles.row}>
            <SocialButton
              label={active.isBlockedByMe ? t.unblock : t.block}
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  setActive(
                    await client.setChatBlocked(active.id, !active.isBlockedByMe),
                  );
                })
              }
            />
            {confirmDelete ? (
              <>
                <Text style={styles.body}>{t.deleteMineConfirm}</Text>
                <SocialButton
                  label={t.deleteMine}
                  primary
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await client.deleteChatMessages(active.id);
                      setConfirmDelete(false);
                      await afterDeletion(active.id);
                    })
                  }
                />
                <SocialButton
                  label={t.cancel}
                  onPress={() => setConfirmDelete(false)}
                />
              </>
            ) : messages.some((m) => m.isOwnMessage) ? (
              <SocialButton
                label={t.deleteMine}
                onPress={() => setConfirmDelete(true)}
              />
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}
