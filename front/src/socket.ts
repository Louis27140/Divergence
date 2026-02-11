import { io } from "socket.io-client";

export const socket = io(import.meta.env.VITE_SOCKET_URL, {
  path: "/socket.io",
  transports: ["websocket"],
  withCredentials: true,
});
