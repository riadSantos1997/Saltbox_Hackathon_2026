import { ChatShell } from "./components/chat/ChatShell";

export default function Home() {
  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col">
      <ChatShell />
    </main>
  );
}
