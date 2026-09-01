import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync } from 'node:fs'
import { DEFAULT_LOCAL_MERGE_WORKFLOW_ID, createDefaultWorkflow, validateWorkflow } from '../shared/workflow'
import { createWorkflowStore, seedDefaultLocalMergeWorkflow } from './workflow-store'
import { testTmpDir } from './test-tmp'

let base: string

beforeEach(() => {
  base = testTmpDir('klarit-seed-')
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('seedDefaultLocalMergeWorkflow', () => {
  it('稳定 id 常量是非空字符串', () => {
    expect(typeof DEFAULT_LOCAL_MERGE_WORKFLOW_ID).toBe('string')
    expect(DEFAULT_LOCAL_MERGE_WORKFLOW_ID.length).toBeGreaterThan(0)
  })

  it('库无该 id 时按稳定 id 种入本地直合默认工作流，并返回该稳定 id', () => {
    const s = createWorkflowStore(base)
    const id = seedDefaultLocalMergeWorkflow(s)
    expect(id).toBe(DEFAULT_LOCAL_MERGE_WORKFLOW_ID)
    const def = s.get(DEFAULT_LOCAL_MERGE_WORKFLOW_ID)
    expect(def).not.toBeNull()
    expect(def?.id).toBe(DEFAULT_LOCAL_MERGE_WORKFLOW_ID)
  })

  it('种入的工作流是合法的本地直合默认（通过 validateWorkflow，与 createDefaultWorkflow 等价）', () => {
    const s = createWorkflowStore(base)
    seedDefaultLocalMergeWorkflow(s)
    const def = s.get(DEFAULT_LOCAL_MERGE_WORKFLOW_ID)
    expect(def).not.toBeNull()
    expect(validateWorkflow(def!).ok).toBe(true)
    expect(def).toEqual(createDefaultWorkflow(DEFAULT_LOCAL_MERGE_WORKFLOW_ID))
  })

  it('幂等：重复调用不产生重复副本、不改变既有内容', () => {
    const s = createWorkflowStore(base)
    seedDefaultLocalMergeWorkflow(s)
    const first = s.get(DEFAULT_LOCAL_MERGE_WORKFLOW_ID)
    seedDefaultLocalMergeWorkflow(s)
    seedDefaultLocalMergeWorkflow(s)
    const withId = s.list().filter((w) => w.id === DEFAULT_LOCAL_MERGE_WORKFLOW_ID)
    expect(withId).toHaveLength(1)
    expect(s.get(DEFAULT_LOCAL_MERGE_WORKFLOW_ID)).toEqual(first)
  })

  it('库非空（存在别的工作流）时也补种该稳定 id，不动既有工作流', () => {
    const s = createWorkflowStore(base)
    s.create('other-wf')
    seedDefaultLocalMergeWorkflow(s)
    expect(s.get('other-wf')).not.toBeNull()
    expect(s.get(DEFAULT_LOCAL_MERGE_WORKFLOW_ID)).not.toBeNull()
  })
})
