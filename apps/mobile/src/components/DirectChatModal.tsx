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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { PpgisApiClient } from '../api/client';
import { getSocialCopy } from '../i18n/social';
import { getTranslations, localizeError, type Locale } from '../i18n/translations';
import {
  avatarInitial,
  filterThreads,
  formatChatDayLabel,
  formatChatTime,
  isSameCalendarDay,
  mergeMessages,
  upsertThreadInList,
} from '../state/chatMessages';
import { firstUnreadIndex, formatRelativeTime } from '../state/feedScope';
import { formatAreaDisplay, MIN_TOUCH_TARGET_DP } from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import { RADII, TABULAR_NUMS_STYLE, type ThemePalette } from '../theme/tokens';
import { ChatGlyph } from './NavGlyphs';
import { SocialButton, SocialCheckbox, useSocialStyles } from './SocialUi';
import { groundLabel } from './SpaceSections';
import { withWebTooltip } from './webTooltip';

export const CHAT_POLL_MS = 5_000;
const THREAD_LIST_POLL_MS = 15_000;

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

function svgIcon(
  paths: readonly string[],
  color: string,
  size = 18,
): React.JSX.Element {
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: color,
      strokeWidth: '2.1',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      style: { flexShrink: 0, display: 'block' },
    },
    ...paths.map((d) => React.createElement('path', { key: d, d })),
  );
}

function PlusGlyph({ color, size = 18 }: { color: string; size?: number }) {
  if (Platform.OS === 'web') {
    return svgIcon(['M12 5v14', 'M5 12h14'], color, size);
  }
  return <Text style={{ color, fontSize: size, fontWeight: '700', lineHeight: size + 2 }}>+</Text>;
}

function GearGlyph({ color, size = 18 }: { color: string; size?: number }) {
  if (Platform.OS === 'web') {
    return svgIcon(
      [
        'M4 7h10',
        'M18 7h2',
        'M14 5v4',
        'M4 17h4',
        'M12 17h8',
        'M8 15v4',
        'M4 12h16',
        'M12 10v4',
      ],
      color,
      size,
    );
  }
  return <Text style={{ color, fontSize: size - 2, fontWeight: '700' }}>⚙</Text>;
}

function CloseGlyph({ color, size = 18 }: { color: string; size?: number }) {
  if (Platform.OS === 'web') {
    return svgIcon(['M6 6l12 12', 'M18 6l-12 12'], color, size);
  }
  return <Text style={{ color, fontSize: size, fontWeight: '700', lineHeight: size + 2 }}>×</Text>;
}

function BackGlyph({ color, size = 18 }: { color: string; size?: number }) {
  if (Platform.OS === 'web') {
    return svgIcon(['M15 18l-6-6 6-6', 'M9 12h11'], color, size);
  }
  return <Text style={{ color, fontSize: size, fontWeight: '700', lineHeight: size + 2 }}>←</Text>;
}

function MoreGlyph({ color, size = 18 }: { color: string; size?: number }) {
  if (Platform.OS === 'web') {
    return svgIcon(
      ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
      color,
      size,
    );
  }
  return <Text style={{ color, fontSize: size, fontWeight: '800', lineHeight: size }}>⋯</Text>;
}

function SendGlyph({ color, size = 18 }: { color: string; size?: number }) {
  if (Platform.OS === 'web') {
    return svgIcon(['M22 2L11 13', 'M22 2l-7 20-4-9-9-4 20-7z'], color, size);
  }
  return <Text style={{ color, fontSize: size - 2, fontWeight: '800' }}>➤</Text>;
}

function avatarColors(
  pseudonym: string,
  active: boolean,
  palette: ThemePalette,
): { bg: string; border: string; text: string } {
  if (!active || pseudonym === 'deleted') {
    return {
      bg: palette.bgRecessed,
      border: palette.borderStrong,
      text: palette.inkMuted,
    };
  }
  const tones = [
    { bg: palette.positiveBg, border: palette.positiveBorder, text: palette.positiveText },
    { bg: palette.infoBg, border: palette.infoBorder, text: palette.infoText },
    { bg: palette.neutralBg, border: palette.neutralBorder, text: palette.neutralText },
    { bg: palette.finishedBg, border: palette.finishedBorder, text: palette.finishedText },
    { bg: palette.inProgressBg, border: palette.inProgressBorder, text: palette.inProgressText },
  ];
  let hash = 0;
  for (let i = 0; i < pseudonym.length; i += 1) {
    hash = (hash * 31 + pseudonym.charCodeAt(i)) >>> 0;
  }
  return tones[hash % tones.length]!;
}

export function DirectChatModal(props: {
  locale: Locale;
  user: AuthUser;
  client: PpgisApiClient;
  start: ChatStart;
  compact?: boolean;
  retentionDays: number;
  resolveUploadUrl: (url: string) => string;
  onUserUpdated: (user: AuthUser) => void;
  onThreadsUpdated?: (threads: ChatThread[]) => void;
  onShowPolygon: (polygonId: string) => void;
  onReport: (messageId: string) => void;
  onError: (err: unknown) => Promise<boolean>;
  /** Asked after new messages arrived, so the newest one is in view. */
  onScrollToEnd?: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { palette } = useTheme();
  const { styles: socialStyles } = useSocialStyles();
  const s = useMemo(() => createStyles(palette), [palette]);
  const {
    client,
    compact = false,
    locale,
    onClose,
    onError,
    onScrollToEnd,
    onThreadsUpdated,
  } = props;
  const t = getSocialCopy(locale);

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [active, setActive] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const afterRef = useRef<string | null>(null);
  const countRef = useRef(0);
  const activeIdRef = useRef<string | null>(null);
  const messagesScrollRef = useRef<ScrollView | null>(null);

  const [draft, setDraftText] = useState('');
  // One draft per conversation: text typed for one person never follows the
  // reader into another conversation.
  const draftsRef = useRef(new Map<string, string>());
  const [recipient, setRecipient] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [threadActionsOpen, setThreadActionsOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

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

  useEffect(() => {
    if (threadsLoaded) {
      onThreadsUpdated?.(threads);
    }
  }, [threads, threadsLoaded, onThreadsUpdated]);

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
    const list = await client.listChats();
    setThreads(list);
    setThreadsLoaded(true);
    setNowMs(Date.now());
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
      setThreads((prev) => upsertThreadInList(prev, page.thread));
      setThreadsLoaded(true);
      setMessages(page.messages);
      setOlderCursor(page.nextBeforeCursor);
      afterRef.current = page.nextAfterCursor;
      countRef.current = page.thread.messageCount;
      setConnectionLost(false);
      setNowMs(Date.now());
      if (switching) {
        setDraftText(draftsRef.current.get(threadId) ?? '');
        setConfirmDelete(false);
        setThreadActionsOpen(false);
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

  const scrollTimelineToEnd = useCallback((): void => {
    setTimeout(() => {
      messagesScrollRef.current?.scrollToEnd({ animated: false });
      onScrollToEnd?.();
    }, 0);
  }, [onScrollToEnd]);

  const newestId = messages[messages.length - 1]?.id ?? null;
  const activeId = active?.id ?? null;

  useEffect(() => {
    if (newestId !== null || activeId !== null) {
      scrollTimelineToEnd();
    }
  }, [newestId, activeId, scrollTimelineToEnd]);

  // Poll the active conversation for incoming messages.
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
          setThreads((prev) => upsertThreadInList(prev, page.thread));
          setConnectionLost(false);
          setNowMs(Date.now());
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

  // Refresh the sidebar thread list periodically while the chats window is open.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!isForeground()) {
        return;
      }
      void refreshThreads().catch(() => undefined);
    }, THREAD_LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshThreads]);

  // Close open sub-panels or the chats window on Escape (Web).
  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    const g = globalThis as {
      addEventListener?: (t: string, l: (ev: { key?: string }) => void) => void;
      removeEventListener?: (t: string, l: (ev: { key?: string }) => void) => void;
    };
    const onKeyDown = (ev: { key?: string }): void => {
      if (ev.key !== 'Escape') {
        return;
      }
      if (newChatOpen) {
        setNewChatOpen(false);
      } else if (settingsOpen) {
        setSettingsOpen(false);
      } else if (threadActionsOpen) {
        setThreadActionsOpen(false);
      } else {
        onClose();
      }
    };
    g.addEventListener?.('keydown', onKeyDown);
    return () => g.removeEventListener?.('keydown', onKeyDown);
  }, [newChatOpen, settingsOpen, threadActionsOpen, onClose]);

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
    setThreadActionsOpen(false);
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
    if (!active || body.length === 0 || busy) {
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

  const handleStartNewChat = (): void => {
    const cleaned = recipient.trim();
    if (cleaned.length < 3 || busy) {
      return;
    }
    void run(async () => {
      const thread = await client.openChat({
        recipientPseudonym: cleaned,
      });
      setRecipient('');
      setNewChatOpen(false);
      setSettingsOpen(false);
      await loadThread(thread.id, 0);
    });
  };

  const filteredThreads = useMemo(
    () => filterThreads(threads, searchQuery),
    [threads, searchQuery],
  );
  const requests = filteredThreads.filter(
    (thread) => thread.requestState === 'incoming',
  );
  const conversations = filteredThreads.filter(
    (thread) => thread.requestState !== 'incoming',
  );

  const renderAvatar = (
    pseudonym: string,
    counterpartActive: boolean,
    size = 40,
  ): React.JSX.Element => {
    const colors = avatarColors(pseudonym, counterpartActive, palette);
    return (
      <View
        style={[
          s.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.bg,
            borderColor: colors.border,
          },
        ]}
      >
        <Text
          style={[
            s.avatarLetter,
            { color: colors.text, fontSize: Math.round(size * 0.42) },
          ]}
        >
          {avatarInitial(pseudonym)}
        </Text>
      </View>
    );
  };

  const renderThreadRow = (thread: ChatThread): React.JSX.Element => {
    const isSelected = active?.id === thread.id;
    const isUnread = thread.unreadCount > 0;
    const timeLabel = thread.lastMessageAt
      ? formatRelativeTime(thread.lastMessageAt, locale, nowMs)
      : '';
    const previewText =
      thread.lastMessagePreview === null
        ? t.noMessagesYet
        : thread.lastMessageSenderPseudonym === props.user.pseudonym
          ? `${t.youPrefix}: ${thread.lastMessagePreview}`
          : thread.lastMessagePreview;

    return (
      <Pressable
        key={thread.id}
        testID={`chat-thread-${thread.id}`}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        onPress={() => {
          setNewChatOpen(false);
          setSettingsOpen(false);
          void run(() => loadThread(thread.id, thread.unreadCount));
        }}
        style={({ pressed }) => [
          s.threadRow,
          isSelected ? s.threadRowSelected : null,
          pressed ? s.threadRowPressed : null,
        ]}
      >
        {isSelected ? <View style={s.threadSelectedBar} /> : null}
        {renderAvatar(thread.counterpartPseudonym, thread.counterpartActive, 42)}
        <View style={s.threadMeta}>
          <View style={s.threadTopLine}>
            <View style={s.threadNameGroup}>
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[s.threadName, isUnread ? s.threadNameUnread : null]}
              >
                {name(thread.counterpartPseudonym)}
              </Text>
              {thread.requestState !== 'none' ? (
                <View style={s.miniPill}>
                  <Text style={s.miniPillText}>{t.requestBadge}</Text>
                </View>
              ) : null}
              {thread.isBlockedByMe ? (
                <View style={[s.miniPill, s.miniPillDanger]}>
                  <Text style={[s.miniPillText, s.miniPillDangerText]}>
                    {t.blockedBadge}
                  </Text>
                </View>
              ) : null}
            </View>
            {timeLabel.length > 0 ? (
              <Text style={[s.threadTime, isUnread ? s.threadTimeUnread : null]}>
                {timeLabel}
              </Text>
            ) : null}
          </View>
          <View style={s.threadBottomLine}>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                s.threadPreview,
                isUnread ? s.threadPreviewUnread : null,
                thread.lastMessagePreview === null ? s.threadPreviewMuted : null,
              ]}
            >
              {previewText}
            </Text>
            {isUnread ? (
              <View style={s.unreadBadge}>
                <Text style={s.unreadBadgeText}>
                  {thread.unreadCount > 99 ? '99+' : thread.unreadCount}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  };

  const renderIconBtn = (opts: {
    testID?: string;
    label: string;
    active?: boolean;
    onPress: () => void;
    icon: (color: string) => React.JSX.Element;
  }): React.JSX.Element =>
    withWebTooltip(
      opts.label,
      <Pressable
        testID={opts.testID}
        accessibilityRole="button"
        accessibilityLabel={opts.label}
        onPress={opts.onPress}
        style={({ pressed }) => [
          s.iconBtn,
          opts.active ? s.iconBtnActive : null,
          pressed ? s.iconBtnPressed : null,
        ]}
      >
        {opts.icon(opts.active ? palette.inkOnAccent : palette.inkPrimary)}
      </Pressable>,
    );

  const sidebarNode = (
    <View style={[s.sidebar, compact ? s.sidebarFull : s.sidebarSplit]}>
      <View style={s.sidebarHeader}>
        <Text numberOfLines={1} style={s.sidebarTitle}>
          {t.chatTitle}
        </Text>
        <View style={s.headerActionGroup}>
          {renderIconBtn({
            testID: 'chat-new-button',
            label: t.newChat,
            active: newChatOpen,
            onPress: () => {
              setSettingsOpen(false);
              setNewChatOpen((prev) => !prev);
            },
            icon: (color) => <PlusGlyph color={color} />,
          })}
          {renderIconBtn({
            testID: 'chat-settings-toggle',
            label: t.chatSettings,
            active: settingsOpen,
            onPress: () => {
              setNewChatOpen(false);
              setSettingsOpen((prev) => !prev);
            },
            icon: (color) => <GearGlyph color={color} />,
          })}
          {compact
            ? renderIconBtn({
                testID: 'chat-close',
                label: t.close,
                onPress: onClose,
                icon: (color) => <CloseGlyph color={color} />,
              })
            : null}
        </View>
      </View>

      {error && (compact || active === null || newChatOpen) ? (
        <View style={s.errorBanner}>
          <Text style={socialStyles.error}>{error}</Text>
        </View>
      ) : null}

      {newChatOpen ? (
        <View style={s.drawerPanel}>
          <Text style={socialStyles.subtitle}>{t.newChatTitle}</Text>
          <Text style={socialStyles.hint}>{t.startNewChatHint}</Text>
          <TextInput
            testID="chat-recipient"
            accessibilityLabel={t.startWith}
            placeholder={t.startWith}
            placeholderTextColor={palette.inkMuted}
            value={recipient}
            onChangeText={setRecipient}
            onSubmitEditing={handleStartNewChat}
            returnKeyType="go"
            autoCapitalize="none"
            autoFocus
            style={socialStyles.input}
          />
          <View style={socialStyles.row}>
            <SocialButton
              testID="chat-start-submit"
              label={t.start}
              primary
              disabled={busy || recipient.trim().length < 3}
              onPress={handleStartNewChat}
            />
            <SocialButton
              label={t.cancel}
              onPress={() => {
                setNewChatOpen(false);
                setError(null);
              }}
            />
          </View>
        </View>
      ) : null}

      {settingsOpen ? (
        <View style={s.drawerPanel}>
          <Text style={socialStyles.subtitle}>{t.chatSettings}</Text>
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
          <Text style={socialStyles.hint}>{t.allowDmHint}</Text>
          <Text style={socialStyles.hint}>{t.chatNotice(props.retentionDays)}</Text>
        </View>
      ) : null}

      {threads.length > 0 && !newChatOpen ? (
        <View style={s.searchBox}>
          <TextInput
            testID="chat-search-input"
            accessibilityLabel={t.searchChats}
            placeholder={t.searchChats}
            placeholderTextColor={palette.inkMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            style={s.searchInput}
          />
        </View>
      ) : null}

      {attachment !== null && attachment.threadId === null ? (
        <View style={s.attachPromptBanner}>
          <Text style={s.attachPromptText}>{t.choosePerson}</Text>
        </View>
      ) : null}

      <ScrollView
        style={s.flexScroll}
        contentContainerStyle={s.threadListContent}
        keyboardShouldPersistTaps="handled"
      >
        {threads.length === 0 ? (
          <View style={s.emptyInbox}>
            <Text style={s.emptyInboxText}>
              {busy && !threadsLoaded ? t.loading : t.chatEmpty}
            </Text>
            {!newChatOpen ? (
              <SocialButton
                label={t.newChat}
                primary
                onPress={() => {
                  setSettingsOpen(false);
                  setNewChatOpen(true);
                }}
              />
            ) : null}
          </View>
        ) : filteredThreads.length === 0 ? (
          <View style={s.emptyInbox}>
            <Text style={s.emptyInboxText}>{t.noSearchMatches}</Text>
          </View>
        ) : (
          <>
            {requests.length > 0 ? (
              <>
                <Text style={s.sectionHeader}>{t.requestsTitle}</Text>
                {requests.map(renderThreadRow)}
                {conversations.length > 0 ? (
                  <Text style={s.sectionHeader}>{t.conversationsTitle}</Text>
                ) : null}
              </>
            ) : null}
            {conversations.map(renderThreadRow)}
          </>
        )}
      </ScrollView>
    </View>
  );

  const renderComposerKeyPress = (e: {
    nativeEvent: { key?: string };
    preventDefault?: () => void;
  }): void => {
    if (Platform.OS !== 'web') {
      return;
    }
    const native = e.nativeEvent as { key?: string; shiftKey?: boolean };
    if (native.key === 'Enter' && !native.shiftKey) {
      e.preventDefault?.();
      send();
    }
  };

  const conversationPaneNode =
    active === null ? (
      <View style={s.pane}>
        <View style={s.emptyPaneTopBar}>
          <View style={s.growSpacer} />
          {renderIconBtn({
            testID: 'chat-close',
            label: t.close,
            onPress: onClose,
            icon: (color) => <CloseGlyph color={color} />,
          })}
        </View>
        <View style={s.emptyPaneCenter}>
          <View style={s.emptyHeroCircle}>
            <ChatGlyph color={palette.accentPrimary} size={30} />
          </View>
          <Text style={s.emptyPaneTitle}>{t.chatTitle}</Text>
          <Text style={s.emptyPaneBody}>
            {attachment !== null ? t.choosePerson : t.selectConversation}
          </Text>
          <SocialButton
            label={t.newChat}
            primary
            onPress={() => {
              setSettingsOpen(false);
              setNewChatOpen(true);
            }}
          />
          <Text style={s.emptyPaneNotice}>{t.chatNotice(props.retentionDays)}</Text>
        </View>
      </View>
    ) : (
      <View style={s.pane}>
        <View style={s.threadHeader}>
          <View style={s.threadHeaderLeft}>
            {compact
              ? renderIconBtn({
                  testID: 'chat-back',
                  label: t.back,
                  onPress: closeThread,
                  icon: (color) => <BackGlyph color={color} />,
                })
              : null}
            {renderAvatar(active.counterpartPseudonym, active.counterpartActive, 36)}
            <View style={s.threadHeaderTitles}>
              <Text numberOfLines={1} style={s.threadHeaderName}>
                {name(active.counterpartPseudonym)}
              </Text>
              {active.isBlockedByMe ||
              !active.counterpartActive ||
              active.requestState !== 'none' ? (
                <Text numberOfLines={1} style={s.threadHeaderSub}>
                  {[
                    !active.counterpartActive ? t.accountDeleted : null,
                    active.isBlockedByMe ? t.blockedBadge : null,
                    active.requestState !== 'none' ? t.requestBadge : null,
                  ]
                    .filter((part): part is string => part !== null)
                    .join(' · ')}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={s.headerActionGroup}>
            {renderIconBtn({
              testID: 'chat-thread-actions',
              label: t.threadActions,
              active: threadActionsOpen,
              onPress: () => {
                setConfirmDelete(false);
                setThreadActionsOpen((prev) => !prev);
              },
              icon: (color) => <MoreGlyph color={color} />,
            })}
            {renderIconBtn({
              testID: 'chat-close',
              label: t.close,
              onPress: onClose,
              icon: (color) => <CloseGlyph color={color} />,
            })}
          </View>
        </View>

        {threadActionsOpen ? (
          <View style={s.actionsTray}>
            <View style={socialStyles.row}>
              <SocialButton
                label={active.isBlockedByMe ? t.unblock : t.block}
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    const updated = await client.setChatBlocked(
                      active.id,
                      !active.isBlockedByMe,
                    );
                    setActive(updated);
                    setThreads((prev) => upsertThreadInList(prev, updated));
                  })
                }
              />
              {confirmDelete ? (
                <>
                  <Text style={socialStyles.body}>{t.deleteMineConfirm}</Text>
                  <SocialButton
                    label={t.deleteMine}
                    primary
                    disabled={busy}
                    onPress={() =>
                      void run(async () => {
                        await client.deleteChatMessages(active.id);
                        setConfirmDelete(false);
                        setThreadActionsOpen(false);
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
          </View>
        ) : null}

        {error && !newChatOpen ? (
          <View style={s.errorBanner}>
            <Text style={socialStyles.error}>{error}</Text>
          </View>
        ) : null}

        <ScrollView
          ref={messagesScrollRef}
          style={s.flexScroll}
          contentContainerStyle={s.timelineContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.noticePill}>
            <Text style={s.noticePillText}>{t.chatNotice(props.retentionDays)}</Text>
          </View>

          {olderCursor ? (
            <View style={s.centerAction}>
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
            </View>
          ) : null}

          {active.requestState === 'incoming' ? (
            <View style={socialStyles.notice} testID="chat-request-incoming">
              <Text style={socialStyles.body}>
                {t.requestIncoming(
                  name(active.counterpartPseudonym),
                  CHAT_LIMITS.REQUEST_RETENTION_DAYS,
                )}
              </Text>
            </View>
          ) : null}

          {connectionLost ? (
            <View style={s.noticePill}>
              <Text style={s.noticePillText}>{t.connectionLost}</Text>
            </View>
          ) : null}

          {messages.map((message, index) => {
            const prevMessage = index > 0 ? (messages[index - 1] ?? null) : null;
            const showDayDivider =
              prevMessage === null ||
              !isSameCalendarDay(prevMessage.createdAt, message.createdAt);
            const dayLabel = showDayDivider
              ? formatChatDayLabel(
                  message.createdAt,
                  locale,
                  { today: t.today, yesterday: t.yesterday },
                  nowMs,
                )
              : '';
            const area = message.referencedPolygon;
            const comment = message.referencedComment;

            return (
              <React.Fragment key={message.id}>
                {showDayDivider && dayLabel.length > 0 ? (
                  <View style={s.dayPill}>
                    <Text style={s.dayPillText}>{dayLabel}</Text>
                  </View>
                ) : null}

                {message.id === unreadFromId ? (
                  <Text style={socialStyles.divider} testID="chat-unread-divider">
                    {t.newMessages}
                  </Text>
                ) : null}

                <View
                  style={[
                    socialStyles.bubble,
                    message.isOwnMessage
                      ? [socialStyles.bubbleOwn, s.bubbleOwnShape]
                      : [socialStyles.bubbleOther, s.bubbleOtherShape],
                  ]}
                >
                  <Text style={socialStyles.body}>{message.body}</Text>
                  {area ? (
                    <View style={s.refCard}>
                      {area.thumbUrl ? (
                        <>
                          <Image
                            source={{ uri: props.resolveUploadUrl(area.thumbUrl) }}
                            style={socialStyles.thumb}
                          />
                          <Text style={socialStyles.hint}>
                            {t.photoBy(name(area.thumbUploaderPseudonym ?? 'deleted'))}
                          </Text>
                        </>
                      ) : null}
                      <Text style={socialStyles.hint}>
                        {getTranslations(locale).surfaces[area.surfaceType].label} ·{' '}
                        {groundLabel(area.spaceType, t)} ·{' '}
                        {formatAreaDisplay(area.areaM2, locale)}
                      </Text>
                      <Text
                        style={socialStyles.link}
                        accessibilityRole="link"
                        onPress={() => props.onShowPolygon(area.id)}
                      >
                        {t.showOnMap}
                      </Text>
                    </View>
                  ) : null}
                  {comment ? (
                    <View style={s.commentQuote}>
                      <Text style={socialStyles.hint}>
                        „{comment.bodyExcerpt}“ — {t.commentBy(name(comment.authorPseudonym))}
                      </Text>
                    </View>
                  ) : null}
                  <View style={s.bubbleFooter}>
                    <Text style={[socialStyles.hint, TABULAR_NUMS_STYLE]}>
                      {formatChatTime(message.createdAt, locale)}
                    </Text>
                    {message.isOwnMessage ? (
                      <Text
                        style={socialStyles.link}
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
                        style={socialStyles.link}
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
                </View>
              </React.Fragment>
            );
          })}

          {reportedThreadId === active.id && !active.isBlockedByMe ? (
            <View style={socialStyles.notice} testID="chat-block-offer">
              <Text style={socialStyles.body}>{t.reportedBlockOffer}</Text>
              <SocialButton
                label={t.block}
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    const updated = await client.setChatBlocked(active.id, true);
                    setActive(updated);
                    setThreads((prev) => upsertThreadInList(prev, updated));
                  })
                }
              />
            </View>
          ) : null}
        </ScrollView>

        <View style={s.composerBar}>
          {attached ? (
            <View style={s.attachedStrip}>
              <Text style={[socialStyles.hint, socialStyles.grow]}>
                {attached.commentId ? t.attachedComment : t.attached}
              </Text>
              <SocialButton
                label={t.removeAttachment}
                onPress={() => setAttachment(null)}
              />
            </View>
          ) : null}

          {active.requestState === 'outgoing' ? (
            <Text style={socialStyles.hint} testID="chat-request-outgoing">
              {t.requestOutgoing}
            </Text>
          ) : active.canSend ? (
            <>
              {active.requestState === 'none' && active.messageCount === 0 ? (
                <Text style={socialStyles.hint}>{t.requestFirst}</Text>
              ) : null}
              <View style={s.composerRow}>
                <TextInput
                  testID="chat-input"
                  accessibilityLabel={t.write}
                  placeholder={t.write}
                  placeholderTextColor={palette.inkMuted}
                  value={draft}
                  onChangeText={setDraft}
                  onKeyPress={renderComposerKeyPress}
                  maxLength={CHAT_LIMITS.MAX_MESSAGE_LENGTH}
                  multiline
                  style={[socialStyles.input, s.composerInput]}
                />
                <Pressable
                  testID="chat-send"
                  accessibilityRole="button"
                  accessibilityLabel={t.send}
                  accessibilityState={{
                    disabled: busy || draft.trim().length === 0,
                  }}
                  disabled={busy || draft.trim().length === 0}
                  onPress={send}
                  style={({ pressed }) => [
                    s.sendBtn,
                    busy || draft.trim().length === 0 ? s.sendBtnDisabled : null,
                    pressed && !(busy || draft.trim().length === 0)
                      ? s.sendBtnPressed
                      : null,
                  ]}
                >
                  <SendGlyph color={palette.inkOnAccent} size={18} />
                </Pressable>
              </View>
            </>
          ) : (
            <Text style={socialStyles.hint}>
              {active.isBlockedByMe ? t.blockedByYou : t.cannotSend}
            </Text>
          )}
        </View>
      </View>
    );

  return (
    <View style={s.window} testID="direct-chat-modal">
      {compact ? (
        active === null ? (
          sidebarNode
        ) : (
          conversationPaneNode
        )
      ) : (
        <View style={s.splitRow}>
          {sidebarNode}
          {conversationPaneNode}
        </View>
      )}
    </View>
  );
}

function createStyles(p: ThemePalette) {
  return StyleSheet.create({
    window: {
      flex: 1,
      width: '100%',
      height: '100%',
      minHeight: 0,
      borderRadius: RADII.sheet,
      backgroundColor: p.bgSurface,
      borderWidth: 1.5,
      borderBottomWidth: 3.5,
      borderColor: p.borderStrong,
      overflow: 'hidden',
    },
    splitRow: {
      flex: 1,
      minHeight: 0,
      flexDirection: 'row',
    },
    sidebar: {
      minHeight: 0,
      backgroundColor: p.bgSubtle,
    },
    sidebarSplit: {
      width: 300,
      minWidth: 260,
      maxWidth: 340,
      borderRightWidth: 1.5,
      borderRightColor: p.borderSubtle,
    },
    sidebarFull: {
      flex: 1,
    },
    sidebarHeader: {
      minHeight: 54,
      paddingHorizontal: 12,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      backgroundColor: p.bgSurface,
      borderBottomWidth: 1.5,
      borderBottomColor: p.borderSubtle,
    },
    sidebarTitle: {
      flex: 1,
      fontSize: 17,
      fontWeight: '800',
      letterSpacing: -0.3,
      color: p.inkPrimary,
    },
    headerActionGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0,
    },
    iconBtn: {
      width: 38,
      height: 38,
      minWidth: 38,
      minHeight: 38,
      borderRadius: RADII.md,
      borderWidth: 1.5,
      borderBottomWidth: 3,
      borderColor: p.borderStrong,
      backgroundColor: p.bgSurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconBtnActive: {
      backgroundColor: p.accentPrimary,
      borderColor: p.accentPrimaryStrong,
    },
    iconBtnPressed: {
      transform: [{ translateY: 1 }],
      borderBottomWidth: 1.5,
    },
    drawerPanel: {
      padding: 12,
      gap: 8,
      backgroundColor: p.bgSurface,
      borderBottomWidth: 1.5,
      borderBottomColor: p.borderSubtle,
    },
    searchBox: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: p.borderSubtle,
      backgroundColor: p.bgSubtle,
    },
    searchInput: {
      minHeight: 38,
      paddingHorizontal: 11,
      paddingVertical: 6,
      borderRadius: RADII.md,
      borderWidth: 1.5,
      borderColor: p.borderSubtle,
      backgroundColor: p.bgSurface,
      color: p.inkPrimary,
      fontSize: 14,
    },
    attachPromptBanner: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: p.bgTinted,
      borderBottomWidth: 1,
      borderBottomColor: p.borderAccent,
    },
    attachPromptText: {
      fontSize: 12.5,
      fontWeight: '600',
      color: p.inkPrimary,
    },
    errorBanner: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: p.dangerBg,
      borderBottomWidth: 1,
      borderBottomColor: p.dangerBorder,
    },
    flexScroll: {
      flex: 1,
      minHeight: 0,
    },
    threadListContent: {
      flexGrow: 1,
      paddingBottom: 12,
    },
    sectionHeader: {
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 4,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: p.inkMuted,
    },
    threadRow: {
      position: 'relative',
      minHeight: 64,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: p.borderSubtle,
      backgroundColor: p.bgSubtle,
    },
    threadRowSelected: {
      backgroundColor: p.bgTinted,
    },
    threadRowPressed: {
      backgroundColor: p.bgRecessed,
    },
    threadSelectedBar: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 3.5,
      backgroundColor: p.accentPrimary,
    },
    avatar: {
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    avatarLetter: {
      fontWeight: '800',
    },
    threadMeta: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    threadTopLine: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
    },
    threadNameGroup: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    threadName: {
      fontSize: 14,
      fontWeight: '700',
      color: p.inkPrimary,
      flexShrink: 1,
    },
    threadNameUnread: {
      fontWeight: '800',
    },
    threadTime: {
      fontSize: 11.5,
      color: p.inkMuted,
      flexShrink: 0,
    },
    threadTimeUnread: {
      fontWeight: '700',
      color: p.accentPrimary,
    },
    threadBottomLine: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
    },
    threadPreview: {
      flex: 1,
      fontSize: 12.5,
      color: p.inkSecondary,
    },
    threadPreviewUnread: {
      fontWeight: '700',
      color: p.inkPrimary,
    },
    threadPreviewMuted: {
      fontStyle: 'italic',
      color: p.inkMuted,
    },
    miniPill: {
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: RADII.xs,
      borderWidth: 1,
      borderColor: p.neutralBorder,
      backgroundColor: p.neutralBg,
    },
    miniPillText: {
      fontSize: 10,
      fontWeight: '700',
      color: p.neutralText,
    },
    miniPillDanger: {
      borderColor: p.dangerBorder,
      backgroundColor: p.dangerBg,
    },
    miniPillDangerText: {
      color: p.dangerText,
    },
    unreadBadge: {
      minWidth: 20,
      height: 20,
      paddingHorizontal: 6,
      borderRadius: RADII.pill,
      backgroundColor: p.accentPrimary,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    unreadBadgeText: {
      fontSize: 11,
      fontWeight: '800',
      color: p.inkOnAccent,
    },
    emptyInbox: {
      flex: 1,
      padding: 24,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    emptyInboxText: {
      fontSize: 13.5,
      lineHeight: 19,
      textAlign: 'center',
      color: p.inkMuted,
    },
    pane: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      backgroundColor: p.bgGround,
    },
    emptyPaneTopBar: {
      minHeight: 54,
      paddingHorizontal: 12,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
    },
    growSpacer: {
      flex: 1,
    },
    emptyPaneCenter: {
      flex: 1,
      padding: 28,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    emptyHeroCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: p.bgTinted,
      borderWidth: 1.5,
      borderColor: p.borderAccent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyPaneTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: p.inkPrimary,
    },
    emptyPaneBody: {
      maxWidth: 320,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
      color: p.inkSecondary,
    },
    emptyPaneNotice: {
      maxWidth: 360,
      marginTop: 6,
      fontSize: 11.5,
      lineHeight: 16,
      textAlign: 'center',
      color: p.inkMuted,
    },
    threadHeader: {
      minHeight: 54,
      paddingHorizontal: 12,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      backgroundColor: p.bgSurface,
      borderBottomWidth: 1.5,
      borderBottomColor: p.borderSubtle,
    },
    threadHeaderLeft: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    threadHeaderTitles: {
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    threadHeaderName: {
      fontSize: 15.5,
      fontWeight: '800',
      color: p.inkPrimary,
    },
    threadHeaderSub: {
      fontSize: 11.5,
      fontWeight: '600',
      color: p.inkMuted,
    },
    actionsTray: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: p.bgSubtle,
      borderBottomWidth: 1.5,
      borderBottomColor: p.borderSubtle,
    },
    timelineContent: {
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 8,
      flexGrow: 1,
    },
    noticePill: {
      alignSelf: 'center',
      maxWidth: '92%',
      paddingHorizontal: 11,
      paddingVertical: 6,
      borderRadius: RADII.md,
      backgroundColor: p.bgSurface,
      borderWidth: 1,
      borderColor: p.borderSubtle,
      marginBottom: 4,
    },
    noticePillText: {
      fontSize: 11.5,
      lineHeight: 16,
      textAlign: 'center',
      color: p.inkMuted,
    },
    dayPill: {
      alignSelf: 'center',
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: RADII.pill,
      backgroundColor: p.bgRecessed,
      borderWidth: 1,
      borderColor: p.borderSubtle,
      marginVertical: 4,
    },
    dayPillText: {
      fontSize: 11,
      fontWeight: '700',
      color: p.inkSecondary,
    },
    centerAction: {
      alignItems: 'center',
      marginBottom: 4,
    },
    bubbleOwnShape: {
      borderBottomRightRadius: RADII.xs,
    },
    bubbleOtherShape: {
      borderBottomLeftRadius: RADII.xs,
    },
    refCard: {
      marginTop: 2,
      padding: 8,
      gap: 5,
      borderRadius: RADII.sm,
      backgroundColor: p.bgSubtle,
      borderWidth: 1,
      borderColor: p.borderSubtle,
    },
    commentQuote: {
      paddingLeft: 8,
      borderLeftWidth: 2.5,
      borderLeftColor: p.accentPrimary,
    },
    bubbleFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginTop: 2,
    },
    composerBar: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 8,
      backgroundColor: p.bgSurface,
      borderTopWidth: 1.5,
      borderTopColor: p.borderSubtle,
    },
    attachedStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: RADII.sm,
      backgroundColor: p.bgTinted,
      borderWidth: 1,
      borderColor: p.borderAccent,
    },
    composerRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
    },
    composerInput: {
      flex: 1,
      maxHeight: 110,
    },
    sendBtn: {
      minWidth: MIN_TOUCH_TARGET_DP,
      minHeight: MIN_TOUCH_TARGET_DP,
      paddingHorizontal: 12,
      borderRadius: RADII.md,
      borderWidth: 1.5,
      borderBottomWidth: 3.5,
      borderColor: p.accentPrimaryStrong,
      backgroundColor: p.accentPrimary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnDisabled: {
      opacity: 0.45,
    },
    sendBtnPressed: {
      transform: [{ translateY: 1.5 }],
      borderBottomWidth: 2,
    },
  });
}
