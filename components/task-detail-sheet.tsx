'use client'

import { useEffect, useMemo, useState, type Dispatch, SetStateAction } from 'react'
import { Download, FileText, GitBranch, ListChecks, Loader2, Mail, MessageSquare, Paperclip, X } from 'lucide-react'
import { createTaskReport } from '@/app/actions'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CategoryField } from '@/components/category-field'
import { StatusBadge } from '@/components/status-badge'
import { FileDropzone, AttachmentRow } from '@/components/uploads/file-dropzone'
import { UserAvatar } from '@/components/user-avatar'
import type { TaskProjectOption } from '@/components/create-task-dialog'
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/lib/constants'
import { taskCategoryEnum, taskStatusEnum } from '@/lib/db/schema'
import { categoryLabel, formatDue, formatRelative, fullName, toDateInputValue } from '@/lib/format'
import type { Person } from '@/lib/types'
import type { UploadedFile } from '@/lib/uploads/client'

export type TaskDetailTab = 'overview' | 'files' | 'comments' | 'delivery' | 'reports' | 'links'

type TaskCategory = (typeof taskCategoryEnum.enumValues)[number]
type TaskStatus = (typeof taskStatusEnum.enumValues)[number]
type TaskPriority = keyof typeof TASK_PRIORITY_LABELS

export type TaskReportEntry = {
  id: string
  title: string
  body: string
  createdAt: string | Date
  emailedAt?: string | Date | null
  author?: { initials?: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null } | null
}

type TaskReport = TaskReportEntry

type DetailTask = {
  id: string
  title: string
  description?: string | null
  category: TaskCategory
  categoryCustom?: string | null
  priority: TaskPriority
  status: TaskStatus
  progress?: number
  assigneeId?: string | null
  dueDate: string | Date | null
  startDate?: string | Date | null
  assignee: { initials: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null } | null
  department: { id?: string; name: string; color?: string } | null
  projectId?: string | null
  projectTitle?: string | null
  milestoneId?: string | null
  milestoneTitle?: string | null
  comments?: Array<{
    id: string
    body: string
    createdAt: string | Date
    userId?: string | null
    user: { initials: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null } | null
  }>
  attachments?: Array<{
    id: string
    label: string
    url: string
    bytes?: number | null
    originalName?: string | null
    userId?: string | null
  }>
  approvals?: Array<{
    id: string
    status: string
    decisionReason: string | null
    approver?: { initials: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null } | null
  }>
  deliverables?: Array<{
    id: string
    title: string
    description?: string | null
    status: string
    evidenceUrl: string | null
    evidenceOriginalName?: string | null
    decisionReason?: string | null
  }>
  reports?: TaskReport[]
  blockingDependencies?: Array<{ id: string; blockedTask: { id: string; title: string } }>
  blockedByDependencies?: Array<{ id: string; blockingTask: { id: string; title: string } }>
}

type TaskPatch = {
  title?: string
  description?: string | null
  category?: TaskCategory
  categoryCustom?: string | null
  priority?: TaskPriority
  progress?: number
  assigneeId?: string | null
  dueDate?: string | Date | null
  startDate?: string | Date | null
  assignee?: { initials: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null } | null
}

type DepartmentOption = { id: string; name: string }

const NEW_PROJECT_VALUE = '__new__'

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function slugFilePart(value: string) {
  return value.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 48) || 'report'
}

function downloadReportTxt(report: TaskReportEntry, taskTitle: string) {
  const author = report.author ? fullName(report.author) : 'Unknown author'
  const lines = [
    report.title,
    `Task: ${taskTitle}`,
    `Author: ${author}`,
    `Created: ${new Date(report.createdAt).toLocaleString()}`,
    report.emailedAt ? `Emailed to supervisor: ${new Date(report.emailedAt).toLocaleString()}` : '',
    '',
    report.body,
  ].filter(Boolean)
  downloadTextFile(`${slugFilePart(report.title)}.txt`, lines.join('\n'), 'text/plain;charset=utf-8')
}

function downloadReportHtml(report: TaskReportEntry, taskTitle: string) {
  const author = report.author ? fullName(report.author) : 'Unknown author'
  const escaped = (value: string) =>
    value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const bodyHtml = report.body
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escaped(paragraph.trim()).replaceAll('\n', '<br />')}</p>`)
    .join('')
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escaped(report.title)}</title>
  <style>
    body { font-family: Segoe UI, Helvetica Neue, Arial, sans-serif; margin: 0; padding: 32px 20px; background: #eef3f8; color: #1a2740; }
    .sheet { max-width: 680px; margin: 0 auto; background: #fff; border-radius: 14px; border: 1px solid #d5dee9; box-shadow: 0 10px 30px rgba(15,39,72,.08); overflow: hidden; }
    .head { padding: 22px 26px; background: linear-gradient(135deg,#0f2748,#163a5f); color: #fff; }
    .head em { display: block; font-style: normal; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #7dd3a0; font-weight: 700; }
    .head h1 { margin: 8px 0 0; font-size: 22px; letter-spacing: -.02em; }
    .meta { padding: 16px 26px; border-bottom: 1px solid #e8eef5; font-size: 13px; color: #6b7a90; display: grid; gap: 4px; }
    .body { padding: 22px 26px 28px; font-size: 15px; line-height: 1.6; }
    .body p { margin: 0 0 12px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <article class="sheet">
    <header class="head">
      <em>Task report</em>
      <h1>${escaped(report.title)}</h1>
    </header>
    <div class="meta">
      <div><strong>Task:</strong> ${escaped(taskTitle)}</div>
      <div><strong>Author:</strong> ${escaped(author)}</div>
      <div><strong>Created:</strong> ${escaped(new Date(report.createdAt).toLocaleString())}</div>
      ${report.emailedAt ? `<div><strong>Supervisor notified:</strong> ${escaped(new Date(report.emailedAt).toLocaleString())}</div>` : ''}
    </div>
    <div class="body">${bodyHtml}</div>
  </article>
</body>
</html>`
  downloadTextFile(`${slugFilePart(report.title)}.html`, html, 'text/html;charset=utf-8')
}

export type TaskPlacementInput = {
  projectId: string | null
  milestoneId?: string | null
  newProjectTitle?: string
  newProjectDepartmentId?: string
  newProjectMilestone?: string
}

export type TaskPlacementResult = {
  error?: string
  ok?: true
  projectId?: string | null
  projectTitle?: string | null
  milestoneId?: string | null
  milestoneTitle?: string | null
}

function personDepartmentId(person: Person) {
  return person.departmentId ?? ''
}

export function TaskDetailSheet({
  task,
  people,
  departments,
  otherTasks,
  currentUserId,
  canEdit,
  canProgress,
  isPending,
  detailsSaving,
  detailsError,
  detailsSaved,
  detailTab,
  onTabChange,
  onClose,
  onPatch,
  onSave,
  onStatusChange,
  onProgressCommit,
  commentText,
  commentError,
  onCommentText,
  onAddComment,
  onDeleteComment,
  attachLabel,
  attachUrl,
  showAttachForm,
  attachError,
  onAttachLabel,
  onAttachUrl,
  onShowAttachForm,
  onPersistAttachment,
  onAddLink,
  deletingAttachmentId,
  onDeleteAttachment,
  approvalReason,
  approvalError,
  onApprovalReason,
  onApprove,
  onReject,
  onRequestRevision,
  deliverableTitle,
  deliverableDescription,
  deliverableError,
  onDeliverableTitle,
  onDeliverableDescription,
  onCreateDeliverable,
  deliverableEvidenceById,
  deliverableEvidenceMetaById,
  deliverableNotesById,
  deliverableDecisionById,
  setDeliverableEvidenceById,
  setDeliverableEvidenceMetaById,
  setDeliverableNotesById,
  setDeliverableDecisionById,
  onCreateDeliverableSubmit,
  onVerifyDeliverable,
  onApproveDeliverable,
  onRejectDeliverable,
  dependencyBlockingTaskId,
  onDependencyBlockingTaskId,
  onCreateDependency,
  onDeleteDependency,
  onDeleteTask,
  projects = [],
  canCreateWork = false,
  currentUserDepartmentId = '',
  onSetPlacement,
  onReportsChange,
}: {
  task: DetailTask
  people: Person[]
  departments: DepartmentOption[]
  otherTasks: Array<{ id: string; title: string }>
  currentUserId: string
  canEdit: boolean
  canProgress: boolean
  isPending: boolean
  detailsSaving: boolean
  detailsError: string | null
  detailsSaved: boolean
  detailTab: TaskDetailTab
  onTabChange: (tab: TaskDetailTab) => void
  onClose: () => void
  onPatch: (patch: TaskPatch) => void
  onSave: () => void
  onStatusChange: (status: TaskStatus) => void
  onProgressCommit: (progress: number) => void
  commentText: string
  commentError: string | null
  onCommentText: (value: string) => void
  onAddComment: () => void
  onDeleteComment: (id: string) => void
  attachLabel: string
  attachUrl: string
  showAttachForm: boolean
  attachError: string | null
  onAttachLabel: (value: string) => void
  onAttachUrl: (value: string) => void
  onShowAttachForm: (value: boolean) => void
  onPersistAttachment: (file: UploadedFile) => void | Promise<void>
  onAddLink: () => void
  deletingAttachmentId: string | null
  onDeleteAttachment: (id: string) => void
  approvalReason: string
  approvalError: string | null
  onApprovalReason: (value: string) => void
  onApprove: () => void
  onReject: () => void
  onRequestRevision: () => void
  deliverableTitle: string
  deliverableDescription: string
  deliverableError: string | null
  onDeliverableTitle: (value: string) => void
  onDeliverableDescription: (value: string) => void
  onCreateDeliverable: () => void
  deliverableEvidenceById: Record<string, string>
  deliverableEvidenceMetaById: Record<string, { publicId?: string; bytes?: number; mimeType?: string; originalName?: string }>
  deliverableNotesById: Record<string, string>
  deliverableDecisionById: Record<string, string>
  setDeliverableEvidenceById: Dispatch<SetStateAction<Record<string, string>>>
  setDeliverableEvidenceMetaById: Dispatch<SetStateAction<Record<string, { publicId?: string; bytes?: number; mimeType?: string; originalName?: string }>>>
  setDeliverableNotesById: Dispatch<SetStateAction<Record<string, string>>>
  setDeliverableDecisionById: Dispatch<SetStateAction<Record<string, string>>>
  onCreateDeliverableSubmit: (id: string) => void
  onVerifyDeliverable: (id: string) => void
  onApproveDeliverable: (id: string) => void
  onRejectDeliverable: (id: string) => void
  dependencyBlockingTaskId: string
  onDependencyBlockingTaskId: (value: string) => void
  onCreateDependency: () => void
  onDeleteDependency: (id: string) => void
  onDeleteTask: () => void
  projects?: TaskProjectOption[]
  canCreateWork?: boolean
  currentUserDepartmentId?: string
  onSetPlacement?: (input: TaskPlacementInput) => Promise<TaskPlacementResult>
  onReportsChange?: (reports: TaskReportEntry[]) => void
}) {
  const [confirm, setConfirm] = useState<
    | { kind: 'task' }
    | { kind: 'dependency'; id: string; title: string }
    | { kind: 'independent' }
    | null
  >(null)
  const [draftProjectValue, setDraftProjectValue] = useState(task.projectId ?? '')
  const [draftMilestoneId, setDraftMilestoneId] = useState(task.milestoneId ?? '')
  const [newProjectTitle, setNewProjectTitle] = useState('')
  const [newProjectDepartmentId, setNewProjectDepartmentId] = useState(
    currentUserDepartmentId || task.department?.id || '',
  )
  const [newProjectMilestone, setNewProjectMilestone] = useState('Delivery')
  const [placementSaving, setPlacementSaving] = useState(false)
  const [placementError, setPlacementError] = useState<string | null>(null)
  const [placementSaved, setPlacementSaved] = useState(false)
  const [reportTitle, setReportTitle] = useState('')
  const [reportBody, setReportBody] = useState('')
  const [emailToSupervisor, setEmailToSupervisor] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const [reportSaving, setReportSaving] = useState(false)
  const [reportSaved, setReportSaved] = useState<string | null>(null)
  const [localReports, setLocalReports] = useState<TaskReport[]>(task.reports ?? [])
  const attachmentCount = task.attachments?.length ?? 0
  const commentCount = task.comments?.length ?? 0
  const deliverableCount = task.deliverables?.length ?? 0
  const reportCount = localReports.length
  const linkCount = (task.blockedByDependencies?.length ?? 0) + (task.blockingDependencies?.length ?? 0)
  const saveDisabled = isPending || !canEdit || !task.assigneeId || !task.title.trim()
  const creatingProject = draftProjectValue === NEW_PROJECT_VALUE
  const draftProjectId = creatingProject ? '' : draftProjectValue
  const selectedPlacementProject = projects.find((project) => project.id === draftProjectId) ?? null
  const placementMilestones = selectedPlacementProject?.milestones ?? []
  const currentProjectMissing =
    Boolean(task.projectId) && !projects.some((project) => project.id === task.projectId)

  useEffect(() => {
    setDraftProjectValue(task.projectId ?? '')
    setDraftMilestoneId(task.milestoneId ?? '')
    setNewProjectTitle('')
    setNewProjectDepartmentId(currentUserDepartmentId || task.department?.id || '')
    setNewProjectMilestone('Delivery')
    setPlacementError(null)
    setPlacementSaved(false)
    setReportTitle('')
    setReportBody('')
    setEmailToSupervisor(false)
    setReportError(null)
    setReportSaved(null)
    setLocalReports(task.reports ?? [])
  }, [task.id, currentUserDepartmentId, task.department?.id])

  useEffect(() => {
    setLocalReports(task.reports ?? [])
  }, [task.reports])

  const placementDirty = useMemo(() => {
    if (creatingProject) return Boolean(newProjectTitle.trim())
    const nextProjectId = draftProjectId || null
    const nextMilestoneId = nextProjectId ? draftMilestoneId || null : null
    return nextProjectId !== (task.projectId ?? null) || nextMilestoneId !== (task.milestoneId ?? null)
  }, [
    creatingProject,
    newProjectTitle,
    draftProjectId,
    draftMilestoneId,
    task.projectId,
    task.milestoneId,
  ])

  function onDraftProjectChange(value: string) {
    setDraftProjectValue(value)
    setPlacementSaved(false)
    setPlacementError(null)
    if (value === NEW_PROJECT_VALUE || !value) {
      setDraftMilestoneId('')
      return
    }
    const next = projects.find((project) => project.id === value)
    const keepCurrent = task.projectId === value ? (task.milestoneId ?? '') : ''
    setDraftMilestoneId(keepCurrent || next?.milestones?.[0]?.id || '')
  }

  async function applyPlacement() {
    if (!onSetPlacement || !canEdit) return
    if (creatingProject && !newProjectTitle.trim()) {
      setPlacementError('A project name is required.')
      return
    }
    setPlacementSaving(true)
    setPlacementError(null)
    setPlacementSaved(false)
    try {
      const result = await onSetPlacement(
        creatingProject
          ? {
              projectId: null,
              newProjectTitle: newProjectTitle.trim(),
              newProjectDepartmentId,
              newProjectMilestone: newProjectMilestone.trim() || 'Delivery',
            }
          : {
              projectId: draftProjectId || null,
              milestoneId: draftProjectId ? draftMilestoneId || null : null,
            },
      )
      if (result?.error) {
        setPlacementError(result.error)
        return
      }
      setDraftProjectValue(result.projectId ?? '')
      setDraftMilestoneId(result.milestoneId ?? '')
      setNewProjectTitle('')
      setPlacementSaved(true)
    } finally {
      setPlacementSaving(false)
    }
  }

  function requestPlacementSave() {
    if (!placementDirty) return
    if (!creatingProject && !draftProjectId && task.projectId) {
      setConfirm({ kind: 'independent' })
      return
    }
    void applyPlacement()
  }

  async function handleSaveReport() {
    if (!reportTitle.trim() || !reportBody.trim()) {
      setReportError('Add a title and write the report before saving.')
      return
    }
    setReportSaving(true)
    setReportError(null)
    const formData = new FormData()
    formData.set('taskId', task.id)
    formData.set('title', reportTitle.trim())
    formData.set('body', reportBody.trim())
    formData.set('emailToSupervisor', emailToSupervisor ? '1' : '0')
    const result = await createTaskReport(formData)
    setReportSaving(false)
    if (result && 'error' in result && result.error) {
      setReportError(result.error)
      return
    }
    const currentUserPerson = people.find((person) => person.id === currentUserId)
    const emailed = Boolean(result && 'emailed' in result && result.emailed)
    const created: TaskReport = {
      id: result && 'reportId' in result && result.reportId ? result.reportId : `local-${Date.now()}`,
      title: reportTitle.trim(),
      body: reportBody.trim(),
      createdAt: new Date().toISOString(),
      emailedAt: emailed ? new Date().toISOString() : null,
      author: currentUserPerson
        ? {
            initials: currentUserPerson.initials,
            firstName: currentUserPerson.firstName,
            lastName: currentUserPerson.lastName,
            avatarUrl: currentUserPerson.avatarUrl,
            avatarColor: currentUserPerson.avatarColor,
          }
        : null,
    }
    const nextReports = [created, ...localReports]
    setLocalReports(nextReports)
    onReportsChange?.(nextReports)
    setReportTitle('')
    setReportBody('')
    setEmailToSupervisor(false)
    setReportSaved(emailed ? 'Report saved and emailed to your supervisor.' : 'Report saved.')
  }

  const tabs: Array<{ id: TaskDetailTab; label: string; count?: number; icon: typeof ListChecks }> = [
    { id: 'overview', label: 'Overview', icon: ListChecks },
    { id: 'files', label: 'Files', count: attachmentCount, icon: Paperclip },
    { id: 'comments', label: 'Comments', count: commentCount, icon: MessageSquare },
    { id: 'delivery', label: 'Delivery', count: deliverableCount, icon: ListChecks },
    { id: 'reports', label: 'Reports', count: reportCount, icon: FileText },
    { id: 'links', label: 'Links', count: linkCount, icon: GitBranch },
  ]

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="create-modal task-detail-modal workspace-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="workspace-sheet-head">
          <div className="td-head-copy">
            <span className="eyebrow">
              Task details
              {task.department?.name ? ` · ${task.department.name}` : ''}
              {task.projectTitle
                ? ` · ${task.projectTitle}${task.milestoneTitle ? ` · ${task.milestoneTitle}` : ''}`
                : ' · Independent'}
            </span>
            <input
              id="task-detail-title"
              className="td-title-field"
              value={task.title}
              aria-label="Task title"
              onChange={(event) => onPatch({ title: event.target.value })}
              disabled={isPending || !canEdit}
            />
            <div className="td-head-meta">
              <StatusBadge status={task.status} />
              <StatusBadge status={TASK_PRIORITY_LABELS[task.priority]} />
              <span>
                {task.assignee ? fullName(task.assignee) : 'Unassigned'}
                {' · '}
                {formatDue(task.startDate)} → {formatDue(task.dueDate)}
              </span>
            </div>
          </div>
          <button className="close-button" type="button" aria-label="Close task details" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>

        <nav className="td-tabs" aria-label="Task sections">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                className={`td-tab${detailTab === tab.id ? ' is-on' : ''}`}
                onClick={() => onTabChange(tab.id)}
              >
                <Icon aria-hidden="true" />
                {tab.label}
                {typeof tab.count === 'number' ? <em>{tab.count}</em> : null}
              </button>
            )
          })}
        </nav>

        <div className="workspace-sheet-body">
          {detailTab === 'overview' ? (
            <div className="td-overview">
              <div className="td-primary">
                <label className="form-field">
                  <span>Description</span>
                  <textarea
                    value={task.description ?? ''}
                    onChange={(event) => onPatch({ description: event.target.value })}
                    placeholder="Outcome, context, and what done looks like."
                    disabled={isPending || !canEdit}
                  />
                </label>
                <div className="td-progress-card">
                  <label>
                    <span className="detail-label">Status</span>
                    <select
                      value={task.status}
                      onChange={(event) => onStatusChange(event.target.value as TaskStatus)}
                      disabled={isPending || !canProgress}
                    >
                      {taskStatusEnum.enumValues.map((status) => (
                        <option key={status} value={status}>{TASK_STATUS_LABELS[status]}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="detail-label">Progress</span>
                    <div className="td-progress-row">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={task.progress ?? 0}
                        onChange={(event) => onPatch({ progress: Number(event.target.value) })}
                        onMouseUp={(event) => onProgressCommit(Number((event.target as HTMLInputElement).value))}
                        onTouchEnd={(event) => onProgressCommit(Number((event.target as HTMLInputElement).value))}
                        disabled={isPending || !canProgress}
                      />
                      <strong>{task.progress ?? 0}%</strong>
                    </div>
                  </label>
                </div>
              </div>
              <aside className="td-aside">
                <label className="form-field">
                  <span>Led by</span>
                  <select
                    value={task.assigneeId ?? ''}
                    disabled={isPending || !canEdit}
                    onChange={(event) => {
                      const nextId = event.target.value
                      const nextPerson = people.find((person) => person.id === nextId) ?? null
                      onPatch({
                        assigneeId: nextId,
                        assignee: nextPerson
                          ? {
                              initials: nextPerson.initials,
                              firstName: nextPerson.firstName,
                              lastName: nextPerson.lastName,
                            }
                          : null,
                      })
                    }}
                  >
                    {departments.map((department) => {
                      const members = people.filter((person) => personDepartmentId(person) === department.id)
                      if (members.length === 0) return null
                      return (
                        <optgroup key={department.id} label={department.name}>
                          {members.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.firstName} {person.lastName}
                            </option>
                          ))}
                        </optgroup>
                      )
                    })}
                    {people.some((person) => !personDepartmentId(person)) && (
                      <optgroup label="Unassigned">
                        {people
                          .filter((person) => !personDepartmentId(person))
                          .map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.firstName} {person.lastName}
                            </option>
                          ))}
                      </optgroup>
                    )}
                  </select>
                </label>
                <div className="form-field">
                  <span>Category</span>
                  <CategoryField
                    showLabel={false}
                    disabled={isPending || !canEdit}
                    value={task.category}
                    customValue={task.categoryCustom ?? ''}
                    onChange={(nextCategory, nextCustom) =>
                      onPatch({
                        category: nextCategory as TaskCategory,
                        categoryCustom: nextCategory === 'other' ? nextCustom : null,
                      })
                    }
                  />
                </div>
                <label className="form-field">
                  <span>Priority</span>
                  <select
                    value={task.priority}
                    disabled={isPending || !canEdit}
                    onChange={(event) => onPatch({ priority: event.target.value as TaskPriority })}
                  >
                    {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <div className="td-dates">
                  <label className="form-field">
                    <span>Start</span>
                    <input
                      type="date"
                      value={toDateInputValue(task.startDate)}
                      disabled={isPending || !canEdit}
                      onChange={(event) => onPatch({ startDate: event.target.value || null })}
                    />
                  </label>
                  <label className="form-field">
                    <span>Due</span>
                    <input
                      type="date"
                      value={toDateInputValue(task.dueDate)}
                      disabled={isPending || !canEdit}
                      onChange={(event) => onPatch({ dueDate: event.target.value || null })}
                    />
                  </label>
                </div>
                <div className="form-field td-placement">
                  <span>Project</span>
                  {canEdit && onSetPlacement ? (
                    <>
                      <select
                        value={draftProjectValue}
                        disabled={isPending || placementSaving}
                        onChange={(event) => onDraftProjectChange(event.target.value)}
                      >
                        <option value="">Independent</option>
                        {currentProjectMissing && task.projectId ? (
                          <option value={task.projectId}>{task.projectTitle ?? 'Current project'}</option>
                        ) : null}
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.title}
                            {project.department ? ` · ${project.department}` : ''}
                          </option>
                        ))}
                        {canCreateWork ? <option value={NEW_PROJECT_VALUE}>Create a project for this work…</option> : null}
                      </select>
                      {!creatingProject && draftProjectId && (placementMilestones.length > 0 || task.milestoneId) ? (
                        <label className="form-field" style={{ marginTop: 8, marginBottom: 0 }}>
                          <span>Milestone</span>
                          <select
                            value={draftMilestoneId}
                            disabled={isPending || placementSaving}
                            onChange={(event) => {
                              setDraftMilestoneId(event.target.value)
                              setPlacementSaved(false)
                            }}
                          >
                            <option value="">Not on a milestone yet</option>
                            {task.milestoneId &&
                            !placementMilestones.some((milestone) => milestone.id === task.milestoneId) ? (
                              <option value={task.milestoneId}>{task.milestoneTitle ?? 'Current milestone'}</option>
                            ) : null}
                            {placementMilestones.map((milestone) => (
                              <option key={milestone.id} value={milestone.id}>
                                {milestone.title}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {creatingProject ? (
                        <div className="td-stack" style={{ marginTop: 8 }}>
                          <label className="form-field">
                            <span>Project name</span>
                            <input
                              value={newProjectTitle}
                              onChange={(event) => {
                                setNewProjectTitle(event.target.value)
                                setPlacementSaved(false)
                              }}
                              placeholder="e.g. Task Buddy rollout"
                              disabled={isPending || placementSaving}
                            />
                          </label>
                          <label className="form-field">
                            <span>Home department</span>
                            <select
                              value={newProjectDepartmentId}
                              onChange={(event) => setNewProjectDepartmentId(event.target.value)}
                              disabled={isPending || placementSaving}
                            >
                              <option value="">Select the accountable function</option>
                              {departments.map((department) => (
                                <option key={department.id} value={department.id}>
                                  {department.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="form-field">
                            <span>First milestone</span>
                            <input
                              value={newProjectMilestone}
                              onChange={(event) => setNewProjectMilestone(event.target.value)}
                              placeholder="Delivery"
                              disabled={isPending || placementSaving}
                            />
                          </label>
                        </div>
                      ) : null}
                      {placementError ? <p className="form-error">{placementError}</p> : null}
                      {placementSaved && !placementError ? <p className="form-ok">Placement saved.</p> : null}
                      <div className="td-placement-actions">
                        <button
                          className="filter-pill selected"
                          type="button"
                          disabled={isPending || placementSaving || !placementDirty}
                          onClick={requestPlacementSave}
                        >
                          {placementSaving ? 'Saving…' : task.projectId ? 'Update placement' : 'Link to project'}
                        </button>
                      </div>
                      <p className="td-muted">
                        {creatingProject
                          ? 'Starts a project around this task. You can add more work to it after.'
                          : draftProjectId
                            ? 'This task stays a task. The project is the container it belongs to.'
                            : 'Most work can stay independent. Link it only if it belongs to an initiative.'}
                      </p>
                    </>
                  ) : (
                    <p className="td-muted">
                      {task.projectTitle
                        ? `${task.projectTitle}${task.milestoneTitle ? ` · ${task.milestoneTitle}` : ''}`
                        : 'Independent of a project'}
                    </p>
                  )}
                </div>
                <p className="td-aside-note">
                  {`${categoryLabel(task.category, task.categoryCustom)} work${canEdit ? '. Change fields here, then save.' : '. You can view this task.'}`}
                </p>
              </aside>
            </div>
          ) : null}

          {detailTab === 'files' ? (
            <section className="td-section">
              <header className="td-section-head">
                <h3>Attachments</h3>
                <p>Store specs, screenshots, and working files on this task.</p>
              </header>
              {(task.attachments ?? []).length > 0 ? (
                <div className="td-stack">
                  {task.attachments!.map((attachment) => (
                    <AttachmentRow
                      key={attachment.id}
                      label={attachment.originalName || attachment.label}
                      url={attachment.url}
                      bytes={attachment.bytes}
                      deleting={deletingAttachmentId === attachment.id}
                      onDelete={
                        canProgress && (attachment.userId === currentUserId || canEdit)
                          ? () => onDeleteAttachment(attachment.id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="td-empty">No files yet. Upload a document or paste an https link.</p>
              )}
              {attachError ? <p className="form-error">{attachError}</p> : null}
              {canProgress ? (
                <>
                  <FileDropzone
                    kind="task_attachment"
                    entityId={task.id}
                    disabled={isPending}
                    label="Upload a file"
                    onUploaded={onPersistAttachment}
                  />
                  {showAttachForm ? (
                    <div className="td-inline-form">
                      <input value={attachLabel} onChange={(event) => onAttachLabel(event.target.value)} placeholder="Label" />
                      <input value={attachUrl} onChange={(event) => onAttachUrl(event.target.value)} placeholder="https://..." />
                      <button className="filter-pill selected" type="button" disabled={isPending || !attachLabel.trim() || !attachUrl.trim()} onClick={onAddLink}>Add link</button>
                      <button className="filter-pill" type="button" onClick={() => { onShowAttachForm(false); onAttachLabel(''); onAttachUrl('') }}>Cancel</button>
                    </div>
                  ) : (
                    <button className="filter-pill" type="button" onClick={() => onShowAttachForm(true)}>
                      <Paperclip aria-hidden="true" /> Paste a link instead
                    </button>
                  )}
                </>
              ) : (
                <p className="td-muted">You can view attachments on this task.</p>
              )}
            </section>
          ) : null}

          {detailTab === 'comments' ? (
            <section className="td-section">
              <header className="td-section-head">
                <h3>Comments</h3>
                <p>Leave an update for the owner and anyone following this work.</p>
              </header>
              {(task.comments ?? []).length > 0 ? (
                <div className="td-comments">
                  {task.comments!.map((comment) => (
                    <div key={comment.id} className="td-comment">
                      <UserAvatar
                        initials={comment.user?.initials ?? 'G'}
                        url={comment.user?.avatarUrl}
                        color={comment.user?.avatarColor}
                        size="sm"
                      />
                      <div>
                        <strong>{comment.user ? fullName(comment.user) : 'System'}</strong>
                        {((comment.userId ?? null) === currentUserId || canEdit) ? (
                          <button type="button" className="comment-remove" onClick={() => onDeleteComment(comment.id)}>Remove</button>
                        ) : null}
                        <p>{comment.body}</p>
                        <small>{formatRelative(new Date(comment.createdAt))}</small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="td-empty">No comments yet.</p>
              )}
              {commentError ? <p className="form-error">{commentError}</p> : null}
              <div className="td-composer">
                <input
                  value={commentText}
                  onChange={(event) => onCommentText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      onAddComment()
                    }
                  }}
                  placeholder="Add a comment…"
                  disabled={isPending || !canProgress}
                />
                <Button className="create-button" type="button" disabled={isPending || !canProgress || !commentText.trim()} onClick={onAddComment}>
                  Send
                </Button>
              </div>
            </section>
          ) : null}

          {detailTab === 'delivery' ? (
            <section className="td-section">
              <header className="td-section-head">
                <h3>Approvals</h3>
                <p>Decisions on this task, including reject and revision notes.</p>
              </header>
              {(task.approvals ?? []).length === 0 ? (
                <p className="td-empty">No approvals yet.</p>
              ) : (
                <div className="td-stack">
                  {task.approvals!.slice(0, 6).map((approval) => (
                    <div key={approval.id} className="td-card">
                      <span className="filter-pill">{approval.status}</span>
                      <div>
                        <strong>{approval.approver ? `${approval.approver.firstName} ${approval.approver.lastName}` : 'Approver'}</strong>
                        {approval.decisionReason ? <p>{approval.decisionReason}</p> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {task.status === 'pending_approval' ? (
                <div className="td-card td-card-actions">
                  <label className="form-field">
                    <span>Decision note (required for reject or revision)</span>
                    <textarea
                      value={approvalReason}
                      onChange={(event) => onApprovalReason(event.target.value)}
                      placeholder="Add a clear note for the requester…"
                      disabled={isPending}
                    />
                  </label>
                  {approvalError ? <p className="form-error">{approvalError}</p> : null}
                  <div className="td-actions">
                    <button className="filter-pill selected" type="button" disabled={isPending} onClick={onApprove}>Approve</button>
                    <button className="filter-pill" type="button" disabled={isPending || !approvalReason.trim()} onClick={onReject}>Reject</button>
                    <button className="filter-pill" type="button" disabled={isPending || !approvalReason.trim()} onClick={onRequestRevision}>Request revision</button>
                  </div>
                </div>
              ) : null}

              <header className="td-section-head" style={{ marginTop: 22 }}>
                <h3>Deliverables</h3>
                <p>Define what “done” looks like, then submit evidence for verification.</p>
              </header>
              <div className="td-card">
                <label className="form-field">
                  <span>Title</span>
                  <input
                    value={deliverableTitle}
                    onChange={(event) => onDeliverableTitle(event.target.value)}
                    placeholder="e.g. Q4 handover pack"
                    disabled={isPending || !canProgress}
                  />
                </label>
                <label className="form-field">
                  <span>Description</span>
                  <textarea
                    value={deliverableDescription}
                    onChange={(event) => onDeliverableDescription(event.target.value)}
                    placeholder="Define what “done” looks like."
                    disabled={isPending || !canProgress}
                  />
                </label>
                <button className="filter-pill selected" type="button" disabled={isPending || !canProgress || !deliverableTitle.trim()} onClick={onCreateDeliverable}>
                  Create deliverable
                </button>
                {deliverableError ? <p className="form-error">{deliverableError}</p> : null}
              </div>
              {(task.deliverables ?? []).length === 0 ? (
                <p className="td-empty">No deliverables yet.</p>
              ) : (
                <div className="td-stack">
                  {task.deliverables!.map((deliverable) => (
                    <div key={deliverable.id} className="td-card">
                      <div className="td-card-top">
                        <span className="filter-pill">{deliverable.status}</span>
                        <div>
                          <strong>{deliverable.title}</strong>
                          {deliverable.description ? <p>{deliverable.description}</p> : null}
                          {deliverable.evidenceUrl ? (
                            <a href={deliverable.evidenceUrl} target="_blank" rel="noopener noreferrer">
                              {deliverable.evidenceOriginalName || 'Open evidence'}
                            </a>
                          ) : null}
                        </div>
                      </div>
                      {deliverable.status === 'draft' ? (
                        <div className="td-stack">
                          <FileDropzone
                            kind="deliverable_evidence"
                            entityId={deliverable.id}
                            disabled={isPending || !canProgress}
                            label="Upload evidence"
                            onUploaded={(file) => {
                              setDeliverableEvidenceById((current) => ({ ...current, [deliverable.id]: file.url }))
                              setDeliverableEvidenceMetaById((current) => ({
                                ...current,
                                [deliverable.id]: {
                                  publicId: file.publicId,
                                  bytes: file.bytes,
                                  mimeType: file.mimeType,
                                  originalName: file.originalName,
                                },
                              }))
                            }}
                          />
                          <label className="form-field">
                            <span>Or paste an evidence link</span>
                            <input
                              value={deliverableEvidenceById[deliverable.id] ?? ''}
                              onChange={(event) => {
                                setDeliverableEvidenceById((current) => ({ ...current, [deliverable.id]: event.target.value }))
                                setDeliverableEvidenceMetaById((current) => {
                                  const next = { ...current }
                                  delete next[deliverable.id]
                                  return next
                                })
                              }}
                              placeholder="https://..."
                              disabled={isPending || !canProgress}
                            />
                          </label>
                          <label className="form-field">
                            <span>Submission notes</span>
                            <textarea
                              value={deliverableNotesById[deliverable.id] ?? ''}
                              onChange={(event) => setDeliverableNotesById((current) => ({ ...current, [deliverable.id]: event.target.value }))}
                              placeholder="Add context for verification."
                              disabled={isPending}
                            />
                          </label>
                          <button
                            className="filter-pill selected"
                            type="button"
                            disabled={isPending || !(deliverableEvidenceById[deliverable.id] ?? '').trim()}
                            onClick={() => onCreateDeliverableSubmit(deliverable.id)}
                          >
                            Submit deliverable
                          </button>
                        </div>
                      ) : null}
                      {(deliverable.status === 'submitted' || deliverable.status === 'verified') ? (
                        <div className="td-stack">
                          <label className="form-field">
                            <span>Decision note</span>
                            <textarea
                              value={deliverableDecisionById[deliverable.id] ?? ''}
                              onChange={(event) => setDeliverableDecisionById((current) => ({ ...current, [deliverable.id]: event.target.value }))}
                              placeholder={deliverable.status === 'submitted' ? 'Verification note (optional)…' : 'Approval or rejection note…'}
                              disabled={isPending}
                            />
                          </label>
                          <div className="td-actions">
                            {deliverable.status === 'submitted' ? (
                              <>
                                <button className="filter-pill selected" type="button" disabled={isPending} onClick={() => onVerifyDeliverable(deliverable.id)}>Verify</button>
                                <button className="filter-pill" type="button" disabled={isPending || !(deliverableDecisionById[deliverable.id] ?? '').trim()} onClick={() => onRejectDeliverable(deliverable.id)}>Reject</button>
                              </>
                            ) : (
                              <>
                                <button className="filter-pill selected" type="button" disabled={isPending} onClick={() => onApproveDeliverable(deliverable.id)}>Approve</button>
                                <button className="filter-pill" type="button" disabled={isPending || !(deliverableDecisionById[deliverable.id] ?? '').trim()} onClick={() => onRejectDeliverable(deliverable.id)}>Reject</button>
                              </>
                            )}
                          </div>
                        </div>
                      ) : null}
                      {deliverable.decisionReason ? <p className="td-muted">Note: {deliverable.decisionReason}</p> : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {detailTab === 'reports' ? (
            <section className="td-section">
              <header className="td-section-head">
                <h3>Progress reports</h3>
                <p>Capture what changed, what is blocked, and what you need — optionally notify your supervisor.</p>
              </header>
              {localReports.length > 0 ? (
                <div className="td-report-list">
                  {localReports.map((report) => (
                    <article key={report.id} className="td-card td-report-card">
                      <div className="td-card-top">
                        <UserAvatar
                          initials={report.author?.initials ?? 'G'}
                          url={report.author?.avatarUrl}
                          color={report.author?.avatarColor}
                          size="sm"
                        />
                        <div>
                          <strong>{report.title}</strong>
                          <p className="td-report-body">{report.body}</p>
                          <div className="td-report-meta">
                            <span>{report.author ? fullName(report.author) : 'Author'}</span>
                            <span>{formatRelative(new Date(report.createdAt))}</span>
                            {report.emailedAt ? (
                              <span className="td-report-emailed">
                                <Mail aria-hidden="true" /> Supervisor notified
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="td-report-downloads">
                        <button
                          type="button"
                          className="filter-pill"
                          onClick={() => downloadReportTxt(report, task.title)}
                        >
                          <Download aria-hidden="true" /> .txt
                        </button>
                        <button
                          type="button"
                          className="filter-pill selected"
                          onClick={() => downloadReportHtml(report, task.title)}
                        >
                          <Download aria-hidden="true" /> .html
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="td-empty">No reports yet. File your first update below.</p>
              )}

              {canProgress ? (
                <div className="td-card td-report-compose">
                  <h4>New report</h4>
                  <label className="form-field">
                    <span>Title</span>
                    <input
                      value={reportTitle}
                      onChange={(event) => setReportTitle(event.target.value)}
                      placeholder="e.g. Week 12 progress"
                      disabled={reportSaving || isPending}
                    />
                  </label>
                  <label className="form-field">
                    <span>Report</span>
                    <textarea
                      value={reportBody}
                      onChange={(event) => setReportBody(event.target.value)}
                      placeholder="What moved forward, what is blocked, and what you need next."
                      rows={6}
                      disabled={reportSaving || isPending}
                    />
                  </label>
                  <label className="td-report-email">
                    <input
                      type="checkbox"
                      checked={emailToSupervisor}
                      onChange={(event) => setEmailToSupervisor(event.target.checked)}
                      disabled={reportSaving || isPending}
                    />
                    Email my supervisor
                  </label>
                  {reportError ? <p className="form-error">{reportError}</p> : null}
                  {reportSaved ? <p className="form-ok">{reportSaved}</p> : null}
                  <Button
                    className="create-button"
                    type="button"
                    disabled={reportSaving || isPending || !reportTitle.trim() || !reportBody.trim()}
                    onClick={() => void handleSaveReport()}
                  >
                    {reportSaving ? (
                      <>
                        <Loader2 className="spin-inline" aria-hidden="true" /> Saving…
                      </>
                    ) : emailToSupervisor ? (
                      'Save & email supervisor'
                    ) : (
                      'Save report'
                    )}
                  </Button>
                </div>
              ) : (
                <p className="td-muted">You can read reports on this task.</p>
              )}
            </section>
          ) : null}

          {detailTab === 'links' ? (
            <section className="td-section">
              <header className="td-section-head">
                <h3>Dependencies</h3>
                <p>This task waits on others, or others wait on this one.</p>
              </header>
              <div className="td-link-grid">
                <div>
                  <span className="detail-label">Blocked by</span>
                  {(task.blockedByDependencies ?? []).length === 0 ? (
                    <p className="td-muted">None</p>
                  ) : (
                    <div className="td-chip-row">
                      {task.blockedByDependencies!.map((dependency) => (
                        <span key={dependency.id} className="td-dep-chip">
                          {dependency.blockingTask.title}
                          {canEdit ? (
                            <button
                              type="button"
                              aria-label={`Remove wait on ${dependency.blockingTask.title}`}
                              disabled={isPending}
                              onClick={() =>
                                setConfirm({
                                  kind: 'dependency',
                                  id: dependency.id,
                                  title: dependency.blockingTask.title,
                                })
                              }
                            >
                              <X aria-hidden="true" />
                            </button>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <span className="detail-label">Blocking</span>
                  {(task.blockingDependencies ?? []).length === 0 ? (
                    <p className="td-muted">Doesn’t block others</p>
                  ) : (
                    <div className="td-chip-row">
                      {task.blockingDependencies!.map((dependency) => (
                        <span key={dependency.id} className="td-dep-chip">
                          {dependency.blockedTask.title}
                          {canEdit ? (
                            <button
                              type="button"
                              aria-label={`Stop blocking ${dependency.blockedTask.title}`}
                              disabled={isPending}
                              onClick={() =>
                                setConfirm({
                                  kind: 'dependency',
                                  id: dependency.id,
                                  title: dependency.blockedTask.title,
                                })
                              }
                            >
                              <X aria-hidden="true" />
                            </button>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="td-inline-form">
                <label className="form-field" style={{ flex: 1, marginBottom: 0 }}>
                  <span>Wait for</span>
                  <select
                    value={dependencyBlockingTaskId}
                    onChange={(event) => onDependencyBlockingTaskId(event.target.value)}
                    disabled={isPending}
                  >
                    <option value="" disabled>Select blocking task…</option>
                    {otherTasks.map((entry) => (
                      <option key={entry.id} value={entry.id}>{entry.title}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="filter-pill selected"
                  type="button"
                  disabled={isPending || !dependencyBlockingTaskId || dependencyBlockingTaskId === task.id}
                  onClick={onCreateDependency}
                >
                  Add
                </button>
              </div>
            </section>
          ) : null}
        </div>

        <div className="workspace-sheet-footer">
          {canEdit ? (
            <Button variant="destructive" type="button" disabled={isPending} onClick={() => setConfirm({ kind: 'task' })}>
              Delete task
            </Button>
          ) : null}
          {detailsError ? <p className="form-error">{detailsError}</p> : null}
          {detailsSaved && !detailsError ? <p className="form-ok">Saved.</p> : <p className="td-save-hint">Ctrl/⌘ S to save</p>}
          <Button variant="outline" type="button" onClick={onClose}>Close</Button>
          <Button
            className="create-button"
            type="button"
            disabled={saveDisabled}
            onClick={onSave}
          >
            {detailsSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
      {confirm?.kind === 'task' ? (
       <ConfirmDialog
       title="Delete this task?"
       description={`“${task.title}” and all associated comments, files, and links will be permanently deleted. This action cannot be undone.`}
       confirmLabel="Delete task"
       pending={isPending}
       onCancel={() => setConfirm(null)}
       onConfirm={() => {
         setConfirm(null)
         onDeleteTask()
       }}
     />
      ) : null}
      {confirm?.kind === 'independent' ? (
        <ConfirmDialog
          title="Make this task independent?"
          description={`“${task.title}” will leave ${task.projectTitle ?? 'its project'} and any milestone it is on. The project itself is not deleted.`}
          confirmLabel="Make independent"
          pending={placementSaving || isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            void applyPlacement()
          }}
        />
      ) : null}
      {confirm?.kind === 'dependency' ? (
        <ConfirmDialog
          title="Remove this dependency?"
          description={`This task will no longer wait on “${confirm.title}”. Other work is not deleted.`}
          confirmLabel="Remove link"
          pending={isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const id = confirm.id
            setConfirm(null)
            onDeleteDependency(id)
          }}
        />
      ) : null}
    </div>
  )
}
