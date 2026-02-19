import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { socket } from "../socket";
import type { Channel, Message } from "../types";
import { hasTextChannel } from "../utils/channel";
import { MessageLine } from "./MessageLine";

type MessageFeedProps = {
  channel: Channel | null;
  username: string;
  token: string;
};

export function MessageFeed({ channel, username, token }: MessageFeedProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<string | null>(null);
  const isTypingRef = useRef(false);
  const previousChannelIdRef = useRef<string | null>(null);

  const hasText = hasTextChannel(channel);

  function clearTypingTimer() {
    if (!typingTimeoutRef.current) return;
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = null;
  }

  function stopTyping(channelId?: string) {
    const targetChannelId = channelId ?? typingChannelRef.current;
    if (!targetChannelId) return;

    clearTypingTimer();

    if (isTypingRef.current) {
      socket.emit("typing:stop", { channelId: targetChannelId });
      isTypingRef.current = false;
    }

    if (!channelId || channelId === typingChannelRef.current) {
      typingChannelRef.current = null;
    }
  }

  function startTyping() {
    if (!channel || !hasText) return;

    if (!isTypingRef.current || typingChannelRef.current !== channel.id) {
      if (isTypingRef.current && typingChannelRef.current && typingChannelRef.current !== channel.id) {
        socket.emit("typing:stop", { channelId: typingChannelRef.current });
      }

      socket.emit("typing:start", {
        channelId: channel.id,
        username,
      });

      isTypingRef.current = true;
      typingChannelRef.current = channel.id;
    }

    clearTypingTimer();
    typingTimeoutRef.current = setTimeout(() => {
      stopTyping(channel.id);
    }, 1200);
  }

  // Load messages when channel changes
  useEffect(() => {
    if (!channel || !hasText) {
      setMessages([]);
      return;
    }

    api<{ messages: Message[] }>(`/channels/${channel.id}/messages`, {}, token)
      .then((res) => setMessages(res.messages))
      .catch(console.error);
  }, [channel?.id, hasText, token]);

  // Listen for new messages
  useEffect(() => {
    if (!channel) return;

    function onNewMessage(msg: Message) {
      if (msg.channel_id === channel.id) {
        setMessages((prev) => [msg, ...prev]);
      }
    }

    socket.on("new_message", onNewMessage);
    return () => {
      socket.off("new_message", onNewMessage);
    };
  }, [channel?.id]);

  // Reset input and typing when switching channels
  useEffect(() => {
    const previousChannelId = previousChannelIdRef.current;
    if (previousChannelId && previousChannelId !== channel?.id) {
      stopTyping(previousChannelId);
    }

    previousChannelIdRef.current = channel?.id ?? null;
    setContent("");
    setTypingUsers([]);
  }, [channel?.id]);

  // Listen typing state for selected channel
  useEffect(() => {
    if (!channel || !hasText) {
      setTypingUsers([]);
      return;
    }

    function onTypingState(payload: { channelId: string; users: string[] }) {
      if (payload.channelId !== channel.id) return;
      setTypingUsers(payload.users.filter((name) => name !== username));
    }

    socket.on("typing:state", onTypingState);
    return () => {
      socket.off("typing:state", onTypingState);
    };
  }, [channel?.id, hasText, username]);

  // Ensure typing state is cleared when unmounting
  useEffect(() => {
    return () => {
      stopTyping();
    };
  }, []);

  const typingText = useMemo(() => {
    if (typingUsers.length === 0) return "";
    if (typingUsers.length === 1) return `${typingUsers[0]} ecrit...`;
    if (typingUsers.length === 2) return `${typingUsers[0]} et ${typingUsers[1]} ecrivent...`;
    return `${typingUsers[0]}, ${typingUsers[1]} et ${typingUsers.length - 2} autres ecrivent...`;
  }, [typingUsers]);

  async function sendMessage() {
    if (!channel || !hasText) return;
    const text = content.trim();
    if (!text) return;

    if (text.toLowerCase() === "/wizz") {
      stopTyping(channel.id);
      socket.emit("wizz", {
        channelId: channel.id,
        username,
      });
      setContent("");
      return;
    }

    stopTyping(channel.id);

    await api(
      `/channels/${channel.id}/messages`,
      { method: "POST", body: JSON.stringify({ content: text }) },
      token,
    );

    setContent("");
  }

  // No channel selected
  if (!channel) {
    return (
      <div className="m-feed">
        <div className="m-no-channel">
          <div className="m-no-channel__icon">*</div>
          <div>Select a channel to begin</div>
        </div>
      </div>
    );
  }

  // Voice-only channel
  if (!hasText) {
    return (
      <div className="m-feed">
        <div className="m-voice-only">
          <div className="m-voice-only__icon">*</div>
          <div>Voice-only channel</div>
        </div>
      </div>
    );
  }

  return (
    <div className="m-feed">
      <div className="m-messages">
        {messages.length === 0 ? (
          <div className="m-messages-empty">
            <div className="m-messages-empty__icon">-</div>
            <div>No messages yet</div>
          </div>
        ) : (
          messages.map((msg) => <MessageLine key={msg.id} message={msg} />)
        )}
      </div>

      <div className="m-typing-indicator" aria-live="polite">
        {typingText}
      </div>

      <div className="m-input-bar">
        <span className="m-input-bar__prompt">&gt;</span>
        <input
          className="m-input-bar__input"
          value={content}
          onChange={(e) => {
            const nextValue = e.target.value;
            setContent(nextValue);

            if (!channel || !hasText) return;

            if (nextValue.trim().length === 0) {
              stopTyping(channel.id);
              return;
            }

            startTyping();
          }}
          placeholder={`Message #${channel.name}...`}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendMessage().catch(console.error);
          }}
        />
        <button
          className="m-input-bar__send"
          onClick={() => sendMessage().catch(console.error)}
          disabled={!content.trim()}
        >
          GO
        </button>
      </div>
    </div>
  );
}
