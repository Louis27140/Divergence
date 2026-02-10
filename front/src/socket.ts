import { io } from "socket.io-client";

// Si ton front tourne dans le navigateur: localhost
// Si ton front tourne dans Docker: back
const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export const socket = io(BASE_URL, { transports: ["websocket"] });