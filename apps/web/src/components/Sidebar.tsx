// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

import type { Chat } from '../types'

interface SidebarProps {
  chats: Chat[]
  selectedChatId: string | null
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  loading: boolean
}

export default function Sidebar({
  chats,
  selectedChatId,
  onSelectChat,
  onNewChat,
  loading,
}: SidebarProps) {
  return (
    <div style={styles.sidebar}>
      <button style={styles.newChatButton} onClick={onNewChat}>
        + New chat
      </button>

      <div style={styles.navSection}>
        <NavItem label="Search chat" disabled />
        <NavItem label="AI Debug" disabled />
        <NavItem label="Images" disabled />
        <NavItem label="Codex" disabled />
        <NavItem label="Projects" disabled />
      </div>

      <div style={styles.historySection}>
        <div style={styles.historyHeader}>History</div>
        {loading ? (
          <div style={styles.loadingText}>Loading...</div>
        ) : (
          chats.map((chat) => (
            <div
              key={chat.id}
              style={{
                ...styles.chatItem,
                ...(selectedChatId === chat.id ? styles.chatItemActive : {}),
              }}
              onClick={() => onSelectChat(chat.id)}
            >
              {chat.title}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function NavItem({ label, disabled }: { label: string; disabled?: boolean }) {
  return (
    <div style={disabled ? styles.navItemDisabled : styles.navItem}>
      {label}
      {disabled && <span style={styles.disabledBadge}>Soon</span>}
    </div>
  )
}

const styles = {
  sidebar: {
    width: '260px',
    backgroundColor: '#202123',
    display: 'flex',
    flexDirection: 'column' as const,
    borderRight: '1px solid #4d4d4f',
  },
  newChatButton: {
    margin: '12px',
    padding: '12px',
    backgroundColor: 'transparent',
    border: '1px solid #565869',
    borderRadius: '6px',
    color: '#ececf1',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
  navSection: {
    padding: '8px 12px',
    borderBottom: '1px solid #4d4d4f',
  },
  navItem: {
    padding: '10px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    marginBottom: '4px',
  },
  navItemDisabled: {
    padding: '10px 12px',
    borderRadius: '6px',
    fontSize: '14px',
    marginBottom: '4px',
    color: '#8e8ea0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  disabledBadge: {
    fontSize: '11px',
    padding: '2px 6px',
    backgroundColor: '#40414f',
    borderRadius: '4px',
  },
  historySection: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '8px 12px',
  },
  historyHeader: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#8e8ea0',
    marginBottom: '8px',
    textTransform: 'uppercase' as const,
  },
  loadingText: {
    fontSize: '14px',
    color: '#8e8ea0',
    padding: '10px 12px',
  },
  chatItem: {
    padding: '10px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    marginBottom: '4px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  chatItemActive: {
    backgroundColor: '#343541',
  },
}
