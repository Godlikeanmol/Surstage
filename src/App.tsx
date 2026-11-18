import React, { useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { AuthProvider, useAuth } from './hooks/useAuth.tsx';
import { LobbyView } from './components/LobbyView.tsx';
import { RoomView } from './components/RoomView.tsx';
import { saveRoomToFirestore } from './lib/firebase.ts';

function getInitialRoomCode(): string {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('room') || '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function getStableParticipantId(): string {
  const key = 'surstage_participant_id';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = `u_${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem(key, created);
  return created;
}

function AppContent() {
  const { user } = useAuth();
  const [participantId] = useState<string>(() => getStableParticipantId());
  const [displayName, setDisplayName] = useState<string>(
    () => sessionStorage.getItem('surstage_name') || ''
  );
  const [avatarColor, setAvatarColor] = useState<string>(
    () => localStorage.getItem('surstage_color') || '#FF5A36'
  );
  const [urlRoomCode] = useState<string>(() => getInitialRoomCode());
  const [activeRoomCode, setActiveRoomCode] = useState<string>(() => {
    const initialCode = getInitialRoomCode();
    const joinedThisTab = sessionStorage.getItem('surstage_joined_room') || '';
    const savedName = sessionStorage.getItem('surstage_name') || '';
    return initialCode && joinedThisTab === initialCode && savedName.trim() ? initialCode : '';
  });
  const [activeRoomName, setActiveRoomName] = useState<string | undefined>(undefined);
  const [isRoomCreator, setIsRoomCreator] = useState<boolean>(false);

  useEffect(() => {
    if (user?.displayName && !displayName) {
      setDisplayName(user.displayName);
    }
  }, [user, displayName]);

  const handleChangeName = (name: string) => {
    setDisplayName(name);
    sessionStorage.setItem('surstage_name', name);
  };

  const handleChangeColor = (color: string) => {
    setAvatarColor(color);
    localStorage.setItem('surstage_color', color);
  };

  const handleEnterRoom = (code: string, roomName?: string, createIfMissing = false) => {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const trimmedName = (displayName.trim() || user?.displayName || '').trim();
    if (!trimmedName) return;
    sessionStorage.setItem('surstage_name', trimmedName);
    sessionStorage.setItem('surstage_joined_room', clean);
    setActiveRoomCode(clean);
    setActiveRoomName(roomName);
    setIsRoomCreator(createIfMissing);
    const url = new URL(window.location.href);
    url.searchParams.set('room', clean);
    window.history.replaceState({}, '', url.toString());

    if (user && roomName) {
      saveRoomToFirestore(clean, roomName).catch(() => {});
    }
  };

  const handleLeaveRoom = () => {
    sessionStorage.removeItem('surstage_joined_room');
    setActiveRoomCode('');
    setActiveRoomName(undefined);
    setIsRoomCreator(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.toString());
  };

  const effectiveName = displayName.trim();

  if (activeRoomCode && effectiveName) {
    return (
      <RoomView
        roomCode={activeRoomCode}
        roomNameHint={activeRoomName}
        isRoomCreator={isRoomCreator}
        participantId={participantId}
        displayName={effectiveName}
        avatarColor={avatarColor}
        onLeaveRoom={handleLeaveRoom}
      />
    );
  }

  return (
    <LobbyView
      initialRoomCode={urlRoomCode}
      displayName={displayName}
      avatarColor={avatarColor}
      onChangeDisplayName={handleChangeName}
      onChangeAvatarColor={handleChangeColor}
      onEnterRoom={handleEnterRoom}
    />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}
