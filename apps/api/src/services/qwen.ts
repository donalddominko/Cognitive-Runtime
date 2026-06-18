// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/services/qwen.ts
// HTTP client for the llama.cpp inference server (Qwen 2.5 Coder 3B model).
// Supports blocking completion, server-sent event streaming, and simple chat turn building.
// Invariant: the llama-server must be running and reachable at LLAMA_URL before any method is called.
// Exports: QwenService

/** Shape of a single JSON chunk returned by the llama.cpp /completion endpoint. */
interface LlamaCompletionResponse {
  content?: string
  stop?: boolean
}

/** HTTP client wrapping the llama.cpp server's /completion endpoint for Qwen inference. */
export class QwenService {
  private serverUrl: string

  constructor() {
    this.serverUrl = process.env.LLAMA_URL || 'http://127.0.0.1:8080'
    console.log('🔗 Qwen service connecting to:', this.serverUrl)
  }

  /**
   * Send a single completion request and return the full generated text.
   * Throws if the server is unreachable or returns a non-2xx status.
   */
  async generate(prompt: string, maxTokens: number = 300): Promise<string> {
    try {
      console.log('🤖 Calling llama-server with prompt:', prompt.substring(0, 100) + '...')

      const response = await fetch(`${this.serverUrl}/completion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt,
          n_predict: maxTokens,
          temperature: 0.5,
          top_p: 0.9,
          repeat_penalty: 1.15,
          stop: ['\nUser:', '\nAssistant:', 'User:', '\n\n\n'],
        }),
      })

      if (!response.ok) {
        throw new Error(`llama-server returned ${response.status}: ${response.statusText}`)
      }

      const data = await response.json() as LlamaCompletionResponse

      if (!data.content) {
        throw new Error('No content in llama-server response')
      }

      const generatedText = data.content.trim()
      console.log('✅ Response:', generatedText.substring(0, 100))

      return generatedText
    } catch (error: any) {
      console.error('❌ Error calling llama-server:', error.message)

      if (error.message.includes('fetch failed') || error.code === 'ECONNREFUSED') {
        throw new Error(`llama-server not reachable at ${this.serverUrl}. Ensure Docker container is running.`)
      }

      throw new Error(`Generation failed: ${error.message}`)
    }
  }

  /**
   * Stream a completion request as server-sent events, yielding one token string per chunk.
   * The caller accumulates tokens; the generator returns when the server signals stop.
   */
  async *generateStream(prompt: string, maxTokens: number = 300): AsyncGenerator<string> {
    try {
      console.log('🎬 Streaming from llama-server:', prompt.substring(0, 100) + '...')

      const response = await fetch(`${this.serverUrl}/completion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt,
          n_predict: maxTokens,
          temperature: 0.5,
          top_p: 0.9,
          repeat_penalty: 1.15,
          stop: ['\nUser:', '\nAssistant:', 'User:', '\n\n\n'],
          stream: true,
        }),
      })

      if (!response.ok) {
        throw new Error(`llama-server returned ${response.status}: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('No response body for streaming')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let tokenCount = 0

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          console.log(`✅ Stream completed - ${tokenCount} tokens yielded`)
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonData = JSON.parse(line.slice(6)) as LlamaCompletionResponse

              if (jsonData.content) {
                tokenCount++
                console.log(`📦 Token ${tokenCount}:`, jsonData.content.substring(0, 20))
                yield jsonData.content
              }

              if (jsonData.stop) {
                console.log('🏁 Stop signal received from llama-server')
                return
              }
            } catch (e) {
              console.error('⚠️ Failed to parse SSE line:', line.substring(0, 50))
              continue
            }
          }
        }
      }
    } catch (error: any) {
      console.error('❌ Error streaming from llama-server:', error.message)

      if (error.message.includes('fetch failed') || error.code === 'ECONNREFUSED') {
        throw new Error(`llama-server not reachable at ${this.serverUrl}`)
      }

      throw new Error(`Streaming failed: ${error.message}`)
    }
  }

  /**
   * Build a minimal chat prompt from the last 2 history turns and send a blocking completion.
   * History is truncated to avoid exceeding the context window.
   */
  async chat(userMessage: string, conversationHistory: Array<{ role: string; content: string }> = []): Promise<string> {
    let prompt = ''
    const recent = conversationHistory.slice(-2)

    for (const msg of recent) {
      prompt += msg.role === 'user' ? `User: ${msg.content}\n` : `Assistant: ${msg.content}\n`
    }

    prompt += `User: ${userMessage}\nAssistant:`

    return await this.generate(prompt)
  }

  /**
   * Streaming variant of `chat` — builds the same prompt format, then yields tokens incrementally.
   */
  async *chatStream(userMessage: string, conversationHistory: Array<{ role: string; content: string }> = []): AsyncGenerator<string> {
    let prompt = ''
    const recent = conversationHistory.slice(-2)

    for (const msg of recent) {
      prompt += msg.role === 'user' ? `User: ${msg.content}\n` : `Assistant: ${msg.content}\n`
    }

    prompt += `User: ${userMessage}\nAssistant:`

    yield* this.generateStream(prompt)
  }
}
