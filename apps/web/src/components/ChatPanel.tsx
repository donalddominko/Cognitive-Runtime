// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

import { useState, useEffect, useRef } from 'react'
import Composer from './Composer'
import { fetchMessages } from '../api/client'
import type { Message } from '../types'

interface ChatPanelProps {
  chatId: string | null
  onNewChat: () => void
}

export default function ChatPanel({ chatId, onNewChat }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (chatId) {
      loadMessages(chatId)
    } else {
      setMessages([])
    }
  }, [chatId])

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadMessages = async (id: string) => {
    try {
      setLoading(true)
      const msgs = await fetchMessages(id)
      setMessages(msgs)
    } catch (error) {
      console.error('Failed to load messages:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSendMessage = async (content: string) => {
    if (!chatId) {
      await onNewChat()
      return
    }

    console.log('🚀 Sending message:', content)

    try {
      setStreaming(true)
      
      // Add user message immediately to UI
      const userMsg: Message = {
        id: crypto.randomUUID(),
        chatId,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMsg])

      // Add empty assistant message that will be filled by streaming
      const assistantMsgId = crypto.randomUUID()
      const assistantMsg: Message = {
        id: assistantMsgId,
        chatId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, assistantMsg])

      console.log('📡 Calling streaming endpoint...')

      // Call streaming endpoint
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/ai/chat/stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId, message: content }),
        }
      )

      console.log('📥 Response received:', response.status, response.statusText)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      // Read streaming response
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamDone = false

      console.log('🎬 Starting to read stream...')

      while (!streamDone) {
        const { done, value } = await reader.read()
        
        if (done) {
          console.log('✅ Stream reader done')
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              console.log('📦 SSE data:', data)
              
              if (data.token) {
                // Update assistant message with new token
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMsgId
                      ? { ...msg, content: msg.content + data.token }
                      : msg
                  )
                )
              }
              
              if (data.done) {
                console.log('🏁 Stream marked as done')
                streamDone = true
                
                // Update with final message ID from server
                if (data.messageId) {
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMsgId
                        ? { ...msg, id: data.messageId }
                        : msg
                    )
                  )
                }
                console.log('✅ Stream completed, Run ID:', data.runId)
                break
              }

              if (data.error) {
                console.error('❌ Server error:', data.error)
                throw new Error(data.error)
              }
            } catch (e) {
              console.error('❌ Failed to parse SSE line:', line, e)
            }
          }
        }
      }

      console.log('✅ Message handling complete')

    } catch (error) {
      console.error('❌ Failed to send message:', error)
      
      // Show error in UI
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        chatId: chatId || '',
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error}. Please try again.`,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setStreaming(false)
    }
  }

  if (!chatId) {
    return (
      <div style={styles.emptyState}>
        <h1 style={styles.emptyTitle}>Cognitive Runtime</h1>
        <p style={styles.emptyText}>Powered by Qwen 2.5 Coder 3B</p>
        <button style={styles.startButton} onClick={onNewChat}>
          New Chat
        </button>
      </div>
    )
  }

  return (
    <div style={styles.chatPanel}>
      <div style={styles.messagesContainer}>
        {loading ? (
          <div style={styles.loadingText}>Loading messages...</div>
        ) : messages.length === 0 ? (
          <div style={styles.emptyMessages}>No messages yet. Start the conversation!</div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={msg.role === 'user' ? styles.userMessage : styles.assistantMessage}
              >
                <div style={styles.messageRole}>{msg.role}</div>
                <div style={styles.messageContent}>{msg.content}</div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>
      <Composer onSend={handleSendMessage} disabled={!chatId || streaming} />
    </div>
  )
}

const styles = {
  chatPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    backgroundColor: '#343541',
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#343541',
  },
  emptyTitle: {
    fontSize: '32px',
    fontWeight: 600,
    marginBottom: '16px',
  },
  emptyText: {
    fontSize: '16px',
    color: '#8e8ea0',
    marginBottom: '24px',
  },
  startButton: {
    padding: '12px 24px',
    backgroundColor: '#10a37f',
    border: 'none',
    borderRadius: '6px',
    color: 'white',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  messagesContainer: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '24px',
  },
  loadingText: {
    color: '#8e8ea0',
    textAlign: 'center' as const,
  },
  emptyMessages: {
    color: '#8e8ea0',
    textAlign: 'center' as const,
  },
  userMessage: {
    backgroundColor: '#444654',
    padding: '16px',
    marginBottom: '16px',
    borderRadius: '8px',
  },
  assistantMessage: {
    backgroundColor: '#343541',
    padding: '16px',
    marginBottom: '16px',
    borderRadius: '8px',
    borderLeft: '3px solid #10a37f',
  },
  messageRole: {
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    color: '#8e8ea0',
    marginBottom: '8px',
  },
  messageContent: {
    fontSize: '15px',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap' as const,
  },
}
