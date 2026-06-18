// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

import { useState, KeyboardEvent } from 'react'

interface ComposerProps {
  onSend: (message: string) => void
  disabled?: boolean
}

export default function Composer({ onSend, disabled }: ComposerProps) {
  const [input, setInput] = useState('')

  const handleSend = () => {
    if (input.trim() && !disabled) {
      onSend(input.trim())
      setInput('')
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div style={styles.composer}>
      <div style={styles.inputContainer}>
        <textarea
          style={styles.textarea}
          placeholder="Send a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
        />
        <button style={styles.sendButton} onClick={handleSend} disabled={disabled || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  )
}

const styles = {
  composer: {
    padding: '24px',
    borderTop: '1px solid #4d4d4f',
  },
  inputContainer: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-end',
  },
  textarea: {
    flex: 1,
    padding: '12px',
    backgroundColor: '#40414f',
    border: '1px solid #565869',
    borderRadius: '6px',
    color: '#ececf1',
    fontSize: '15px',
    fontFamily: 'inherit',
    resize: 'none' as const,
    minHeight: '44px',
    maxHeight: '200px',
  },
  sendButton: {
    padding: '12px 24px',
    backgroundColor: '#10a37f',
    border: 'none',
    borderRadius: '6px',
    color: 'white',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    height: '44px',
  },
}
