import { describe, it, expect } from 'vitest'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { parseHandshake, readHandshake } from './handshake'
import { testTmpDir } from '../test-tmp'

describe('parseHandshake — 纯解析（无 fs）', () => {
  it('合法 done', () => {
    expect(parseHandshake('{"status":"done","note":"完成"}')).toEqual({ status: 'done', note: '完成' })
  })

  it('need-decision 带选项/多选/自由输入', () => {
    const h = parseHandshake(
      JSON.stringify({
        status: 'need-decision',
        decision: {
          title: '选哪个',
          options: [{ id: 'a', label: '方案A', recommended: true }, { id: 'b', label: '方案B', detail: '更稳' }],
          multi: false,
          freeInput: true
        }
      })
    )
    expect(h.status).toBe('need-decision')
    expect(h.decision?.options).toHaveLength(2)
    expect(h.decision?.options?.[0]).toEqual({ id: 'a', label: '方案A', recommended: true })
    expect(h.decision?.freeInput).toBe(true)
  })

  it('repos 过滤为字符串数组，供下游收窄', () => {
    expect(parseHandshake('{"status":"done","repos":["api",1,"web",null]}').repos).toEqual(['api', 'web'])
  })

  it('缺失/空/非法 JSON → 乐观 done', () => {
    expect(parseHandshake(null)).toEqual({ status: 'done' })
    expect(parseHandshake('')).toEqual({ status: 'done' })
    expect(parseHandshake('不是 json{')).toEqual({ status: 'done' })
  })

  it('未知 status → 乐观 done（容忍不完美遵守协议）', () => {
    expect(parseHandshake('{"status":"whatever"}').status).toBe('done')
  })

  it('failed 带 detail', () => {
    expect(parseHandshake('{"status":"failed","detail":"编译不过"}')).toEqual({ status: 'failed', detail: '编译不过' })
  })
})

describe('readHandshake — 读引擎指定的绝对路径', () => {
  it('文件存在则读并解析；不存在则乐观 done', () => {
    const dir = testTmpDir('klarit-hs-')
    const path = join(dir, 'plan.json')
    try {
      // 不存在 → done
      expect(readHandshake(path)).toEqual({ status: 'done' })
      // 写入后读到
      writeFileSync(path, '{"status":"failed","detail":"x"}')
      expect(readHandshake(path)).toEqual({ status: 'failed', detail: 'x' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
