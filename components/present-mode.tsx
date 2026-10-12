'use client'

import { useEffect, useMemo, useState } from 'react'
import { COMPANY_SHORT_NAME, PRODUCT_NAME } from '@/lib/branding'
import { buildPresentSlides, type PresentPerson } from '@/lib/present/deck'
import type { QueueResponsibility, QueueTask } from '@/lib/work/queue'

export function PresentMode({
  person,
  responsibilities,
  tasks,
  onExit,
}: {
  person: PresentPerson
  responsibilities: QueueResponsibility[]
  tasks: QueueTask[]
  onExit: () => void
}) {
  const slides = useMemo(
    () => buildPresentSlides({ person, responsibilities, tasks }),
    [person, responsibilities, tasks],
  )
  const [index, setIndex] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [canFullscreen, setCanFullscreen] = useState(false)
  const slide = slides[Math.min(index, slides.length - 1)]
  const agendaIndex = slides.findIndex((entry) => entry.kind === 'agenda')

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        void leave()
        return
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault()
        setIndex((current) => Math.min(slides.length - 1, current + 1))
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        setIndex((current) => Math.max(0, current - 1))
        return
      }
      if (event.key === ' ' || event.code === 'Space') {
        if (event.target instanceof HTMLElement && event.target.closest('button, a, input, textarea')) return
        event.preventDefault()
        setIndex((current) => Math.min(slides.length - 1, current + 1))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onExit, slides.length])

  useEffect(() => {
    setCanFullscreen(Boolean(document.fullscreenEnabled))
    function onFullscreen() {
      setFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  async function leave() {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen()
      } catch {
        // The browser may already have left fullscreen.
      }
    }
    onExit()
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen()
      }
    } catch {
      setFullscreen(Boolean(document.fullscreenElement))
    }
  }

  return (
    <div className="present-stage" role="dialog" aria-modal="true" aria-label={`${PRODUCT_NAME} present mode`}>
      <div className="present-slide">
        {slide?.kind === 'title' ? (
          <>
            <p className="present-kicker">{COMPANY_SHORT_NAME} · {PRODUCT_NAME}</p>
            <h1 className="present-title">{slide.person.name}</h1>
            <p className="present-meta">{slide.person.jobTitle}</p>
            <p className="present-meta">{slide.person.department}</p>
            <p className="present-date">{slide.dateLabel}</p>
          </>
        ) : null}
        {slide?.kind === 'agenda' ? (
          <>
            <p className="present-kicker">Agenda</p>
            <h1 className="present-title">What is open</h1>
            <div className="present-counts">
              <div>
                <strong>{slide.responsibilityCount}</strong>
                <span>Responsibilities</span>
              </div>
              <div>
                <strong>{slide.taskCount}</strong>
                <span>Open tasks</span>
              </div>
            </div>
            <p className="present-note">Responsibilities first, then tasks. One item at a time.</p>
          </>
        ) : null}
        {slide?.kind === 'item' ? (
          <>
            <p className="present-kicker">{slide.kicker}</p>
            <h1 className="present-title">{slide.title}</h1>
            <p className="present-status">{slide.status}{slide.due ? ` · ${slide.due}` : ''}</p>
            <p className="present-meta">{slide.place}</p>
            <p className="present-description">{slide.description}</p>
            <p className="present-progress">{slide.index} / {slide.total}</p>
          </>
        ) : null}
        {slide?.kind === 'close' ? (
          <>
            <p className="present-kicker">Closing</p>
            <h1 className="present-title">That is the queue</h1>
            <div className="present-counts">
              <div>
                <strong>{slide.responsibilityCount}</strong>
                <span>Responsibilities</span>
              </div>
              <div>
                <strong>{slide.taskCount}</strong>
                <span>Open tasks</span>
              </div>
            </div>
            <p className="present-note">Update anything that changed when you are back at your desk.</p>
          </>
        ) : null}
      </div>
      <div className="present-controls">
        <button type="button" onClick={() => setIndex((current) => Math.max(0, current - 1))} disabled={index === 0}>
          Previous
        </button>
        <button type="button" className="present-primary" onClick={() => setIndex((current) => Math.min(slides.length - 1, current + 1))} disabled={index >= slides.length - 1}>
          Next
        </button>
        <button type="button" onClick={() => setIndex(Math.max(0, agendaIndex))}>
          Agenda
        </button>
        {canFullscreen ? (
          <button type="button" onClick={() => void toggleFullscreen()}>
            {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        ) : null}
        <button type="button" onClick={() => void leave()}>
          Exit
        </button>
        <span className="present-hint">Arrows, Space, Esc</span>
      </div>
    </div>
  )
}
