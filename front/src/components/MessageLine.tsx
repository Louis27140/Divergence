import type { Message } from "../types";

type MessageLineProps = {
  message: Message;
};

function usernameHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

function formatMessageDateTime(rawDate: string): string {
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return rawDate;
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfMessageDay.getTime()) / 86400000);

  const time = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  if (dayDiff === 0) {
    return `Aujourd'hui ${time}`;
  }

  if (dayDiff === 1) {
    return `Hier ${time}`;
  }

  const fullDate = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);

  return `${fullDate} ${time}`;
}

export function MessageLine({ message }: MessageLineProps) {
  const hue = usernameHue(message.author_username);
  const color = `hsl(${hue}, 70%, 65%)`;
  const dateTime = formatMessageDateTime(message.created_at);

  return (
    <div className="m-msg">
      <div className="m-msg__bar" style={{ background: color }} />
      <div className="m-msg__author" style={{ color }}>
        {message.author_username}
      </div>
      <div className="m-msg__body">
        <div className="m-msg__text">{message.content}</div>
      </div>
      <div className="m-msg__time" title={message.created_at}>
        {dateTime}
      </div>
    </div>
  );
}
