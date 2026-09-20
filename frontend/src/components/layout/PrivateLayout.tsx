import type { ReactNode } from "react";
import { useState } from "react";
import { Header } from "./Header";
import { NavigationSidebar } from "./NavigationSidebar";
import { MobileBottomNavigation } from "./MobileBottomNavigation";
import { WelcomeModal } from "./WelcomeModal";
import { useAuth } from "../../context/AuthContext";
import "../../styles/components/sidebar.css";

export function PrivateLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [welcomeOpen, setWelcomeOpen] = useState(() => !user?.hasSeenWelcome);

  return (
    <div className="app-shell">
      <Header onWelcomeOpen={() => setWelcomeOpen(true)} />
      <NavigationSidebar onWelcomeOpen={() => setWelcomeOpen(true)} />
      <main className="app-content">
        <div className="content-window">{children}</div>
      </main>
      <MobileBottomNavigation />
      <WelcomeModal
        open={welcomeOpen}
        onClose={() => setWelcomeOpen(false)}
        welcomeName={user?.welcomeName ?? user?.displayName}
      />
    </div>
  );
}
