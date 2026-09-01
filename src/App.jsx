import { useEffect, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase.js'
import { createRemoteRoundVersionMap, deleteRemoteRound, isRoundTombstonedError, loadRemoteProfile, loadRemoteRoundDetail, loadRemoteRoundSyncState, loadRemoteRoundTombstone, markRoundsAsRemoteSaved, mergeRoundCollectionsWithDeletions, resolveOnboardingProfile, saveRemoteProfile, saveRemoteRounds, selectRoundsNeedingRemoteSave, sortRoundsForList } from './lib/roundRepository.js'
import { clearDeletedRoundLocalArtifacts, excludePendingRoundDeletions, loadObservedRoundTombstones, loadPendingRoundDeletions, mergeObservedRoundTombstones, roundDeletionIds, saveObservedRoundTombstones, savePendingRoundDeletions } from './lib/pendingRoundDeletions.js'
import { isRoundStructureLocked, needsRoundStructureChoice } from './lib/roundPolicy.js'
import { calculateHoleTotals, isRecordedShot, terminalLieForShot, validateHoleCompletion } from './lib/scoring.js'
import { calculateCumulativeStats, calculateRoundStats, formatPercent } from './lib/roundStats.js'
import { getRoundDistanceCoverage, holeNeedsManualDistance } from './lib/distanceCoverage.js'
import { compactCoursePair } from './lib/roundPresentation.js'
import { roundCompletionState } from './lib/roundCompletion.js'
import { applyKnownCourseTemplate, findKnownCourse, getKnownCourse, searchKnownCourses, segmentNamesForCourse, selectKnownCourse } from './data/courseData.js'
import { PREVIEW_ROUNDS_VERSION, mergePreviewRounds } from './data/previewRounds.js'
import { authCallbackError, clearAuthCallbackFromAddress, googleOAuthOptions, sanitizedAuthCallbackPath, shouldReportAuthCallbackFailure } from './lib/auth.js'
import { clearRoundHoleDrafts, latestHoleDraft, removeRoundHoleDraft, upsertRoundHoleDraft } from './lib/roundDrafts.js'
import { compareClubOrder, createDistanceSet, distanceFromMeters, distanceToMeters, pairClubsForColumnLayout } from './lib/clubBag.js'
import { clubBagSyncSignature, loadRemoteClubBag, resolveClubBag, saveRemoteClubBag } from './lib/clubBagRepository.js'
import { clearLocalUserData, deleteRemoteAccount } from './lib/accountDeletion.js'
import { hasUnseenNews, latestNewsId, newsItems, newsSeenStorageKey } from './data/news.js'
import { flushPendingLoginMeasurements, getAnalyticsConsent, initializeAnalytics, measureLoginStage, recordLoginFailure, setAnalyticsConsent, startLoginMeasurement, trackEvent, trackScreen } from './lib/analytics.js'
import { resetNavigationForExplicitSignOut } from './lib/navigationPolicy.js'
import { requestTestAccess } from './lib/testAccessRequest.js'
import { MAX_FEEDBACK_LENGTH, sendFeedback } from './lib/feedback.js'
import { scheduleRemoteHydrationRetry, shouldScheduleRemoteHydrationRetry } from './lib/remoteHydrationRetry.js'
import { recordDiagnosticFailure, resolveDiagnosticFailures } from './lib/diagnostics.js'
import { clearDiagnosticQueue, enqueueDiagnosticFailure, enqueueDiagnosticRecovery, flushDiagnosticQueue, setDiagnosticAccessTokenProvider } from './lib/diagnosticsTransport.js'
import golfBallLogo from './assets/golf-ball-logo.png'

const isPreviewMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1'
const isDiagnosticSmokeMode = window.location.hostname.endsWith('.vercel.app')
  && window.location.hostname !== 'golf-and-me.vercel.app'
  && new URLSearchParams(window.location.search).get('diagnostics-smoke') === '1'
const isPreviewOnboardingMode = isPreviewMode && new URLSearchParams(window.location.search).get('onboarding') === '1'
const isTestAccessRequestEnabled = import.meta.env.VITE_TEST_ACCESS_REQUEST_ENABLED === 'true'
const analyticsScreenNames = Object.freeze({
  'new-round': 'new_round',
  'hole-detail': 'hole_detail',
})
const previewSession = {
  user: {
    id: 'preview-user',
    email: 'preview@golf-and-me.local',
    user_metadata: { full_name: '미리보기 사용자' },
  },
}

setDiagnosticAccessTokenProvider(async () => {
  if (!supabase) return ''
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || ''
})

function localDateTimeValue() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function compactDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getFullYear()).slice(-2)}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function createLocalId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `local-${Date.now().toString(36)}-${randomPart}`
}

function newRoundForm(tee = '화이트', distanceUnit = 'M') {
  return { courseId: null, courseName: '', frontCourseName: '', backCourseName: '', tee, distanceUnit, playedAt: localDateTimeValue(), companionMemo: '' }
}

function emptyRoundHoles() {
  return Array.from({ length: 18 }, (_, index) => ({
    holeNumber: index + 1,
    par: null,
    swingCount: null,
    score: null,
    putts: null,
    fir: undefined,
    gir: undefined,
    obCount: 0,
    penaltyCount: 0,
  }))
}

const teeOptions = [
  { value: '블랙', color: 'black', symbol: '●' },
  { value: '블루', color: 'blue', symbol: '●' },
  { value: '화이트', color: 'white', symbol: '●' },
  { value: '골드', color: 'gold', symbol: '●' },
  { value: '레드', color: 'red', symbol: '●' },
]
const clubSelectionRows = [
  { category: '드라이버·우드', options: ['1', '2', '3', '5', '7', '9'] },
  { category: '유틸리티', options: ['2', '3', '4', '5', '6', '7'] },
  { category: '아이언', options: ['2', '3', '4', '5', '6', '7', '8', '9', '10'] },
  { category: '웨지', options: ['P', 'A', 'S', 'L', '48', '50', '52', '54', '56', '58', '60'] },
]

function clubLabel(category, value) {
  if (category === '드라이버·우드') return value === '1' ? 'D' : `${value}W`
  if (category === '유틸리티') return `${value}UT`
  if (category === '아이언') return `${value}I`
  return value
}

const initialClubDrafts = [
  ['드라이버·우드', '1'],
].map(([category, value]) => ({ id: `${category}:${value}`, category, value, label: clubLabel(category, value), custom: false }))
initialClubDrafts.push({ id: '퍼터:PT', category: '퍼터', value: 'PT', label: 'PT', custom: false })

function emptyShot(sequence) {
  return { sequence, club: '', clubId: null, clubSnapshot: null, remainingDistance: '', remainingDistanceSource: null, troubleDirection: null, troubleType: null, obRelief: null, provisionalFor: null }
}

function CalendarIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" /></svg>
}

function ClockIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
}

function TrashIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v5M14 11v5" /></svg>
}

function ParWarningIcon() {
  return <span className="par-warning-icon" role="img" aria-label="PAR 정보가 없는 홀은 파 대비 계산에서 제외됨">⚠️</span>
}

function MegaphoneIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11v2a2 2 0 0 0 2 2h2l2 4h3l-2-4 7 3V6L8 9H6a2 2 0 0 0-2 2Z" /><path d="M20 9v6" /></svg>
}

function FeedbackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /><path d="M8 9h8M8 13h5" /></svg>
}

export default function App() {
  const [session, setSession] = useState(isPreviewMode ? previewSession : null)
  const [authLoading, setAuthLoading] = useState(isPreviewMode ? false : isSupabaseConfigured)
  const [authError, setAuthError] = useState('')
  const [testAccessEmail, setTestAccessEmail] = useState('')
  const [testAccessStatus, setTestAccessStatus] = useState('idle')
  const [testAccessError, setTestAccessError] = useState('')
  const [lastSeenNewsId, setLastSeenNewsId] = useState(null)
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackStatus, setFeedbackStatus] = useState('idle')
  const [feedbackError, setFeedbackError] = useState('')
  const [accountOpen, setAccountOpen] = useState(false)
  const [analyticsConsent, setAnalyticsConsentState] = useState(() => getAnalyticsConsent())
  const [analyticsAddressReady, setAnalyticsAddressReady] = useState(() => !sanitizedAuthCallbackPath(window.location.href))
  const [accountDeletionOpen, setAccountDeletionOpen] = useState(false)
  const [accountDeletionStatus, setAccountDeletionStatus] = useState('idle')
  const [accountDeletionError, setAccountDeletionError] = useState('')
  const [dateTimeOpen, setDateTimeOpen] = useState(false)
  const [draftDate, setDraftDate] = useState('')
  const [draftTime, setDraftTime] = useState('')
  const [onboardingReady, setOnboardingReady] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState(1)
  const [defaultTee, setDefaultTee] = useState('화이트')
  const [defaultDistanceUnit, setDefaultDistanceUnit] = useState('M')
  const [screen, setScreen] = useState('home')
  const [round, setRound] = useState(() => newRoundForm())
  const [rounds, setRounds] = useState([])
  const [activeRound, setActiveRound] = useState(null)
  const [editingActiveRound, setEditingActiveRound] = useState(false)
  const [courseHistory, setCourseHistory] = useState([])
  const [holeDraft, setHoleDraft] = useState(null)
  const [holeMode, setHoleMode] = useState('draft')
  const [initialHoleDraft, setInitialHoleDraft] = useState(null)
  const [activeShotIndex, setActiveShotIndex] = useState('all')
  const [openTroubleRows, setOpenTroubleRows] = useState([])
  const [puttMoreOpen, setPuttMoreOpen] = useState(false)
  const [customPutts, setCustomPutts] = useState('5')
  const [courseSuggestionsOpen, setCourseSuggestionsOpen] = useState(false)
  const [roundPendingDeletion, setRoundPendingDeletion] = useState(null)
  const [pendingStructureChange, setPendingStructureChange] = useState(null)
  const [pendingRoundStart, setPendingRoundStart] = useState(null)
  const [roundCompletionOpen, setRoundCompletionOpen] = useState(false)
  const [navigationReady, setNavigationReady] = useState(false)
  const [restoreHoleNumber, setRestoreHoleNumber] = useState(null)
  const [resumeNotice, setResumeNotice] = useState('')
  const [syncError, setSyncError] = useState('')
  const [syncRecoveredNotice, setSyncRecoveredNotice] = useState('')
  const [remoteProfileHydratedUserId, setRemoteProfileHydratedUserId] = useState(null)
  const [remoteRoundsHydratedUserId, setRemoteRoundsHydratedUserId] = useState(null)
  const [remoteClubBagHydratedUserId, setRemoteClubBagHydratedUserId] = useState(null)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [syncRetryNonce, setSyncRetryNonce] = useState(0)
  const [remoteHydrationRetryNonce, setRemoteHydrationRetryNonce] = useState(0)
  const [pendingDeletedRoundIds, setPendingDeletedRoundIds] = useState([])
  const [observedRoundTombstones, setObservedRoundTombstones] = useState([])
  const [clubDrafts, setClubDrafts] = useState(initialClubDrafts)
  const [inactiveClubDrafts, setInactiveClubDrafts] = useState([])
  const [clubStage, setClubStage] = useState('composition')
  const [clubCompositionEditing, setClubCompositionEditing] = useState(false)
  const [customClubCategory, setCustomClubCategory] = useState(null)
  const [customClubLabel, setCustomClubLabel] = useState('')
  const [clubDistanceUnit, setClubDistanceUnit] = useState('M')
  const [clubDistanceBasis, setClubDistanceBasis] = useState(null)
  const [clubDistanceEditing, setClubDistanceEditing] = useState(false)
  const [clubDistanceInputs, setClubDistanceInputs] = useState({})
  const [clubDistanceSets, setClubDistanceSets] = useState([])
  const [recentlyChangedClubIds, setRecentlyChangedClubIds] = useState([])
  const [diagnosticSmokeStatus, setDiagnosticSmokeStatus] = useState('idle')
  const [clubBagHydrated, setClubBagHydrated] = useState(false)
  const [clubCompositionCompleted, setClubCompositionCompleted] = useState(false)
  const [clubBagUpdatedAt, setClubBagUpdatedAt] = useState(null)
  const [clubSetupReturn, setClubSetupReturn] = useState(null)
  const [clubSetupPromptOpen, setClubSetupPromptOpen] = useState(false)
  const courseNameInputRef = useRef(null)
  const hadSyncIssueRef = useRef(false)
  const remoteHydrationRetryAttemptsRef = useRef(0)
  const recordsReadyMeasuredUserIdRef = useRef(null)
  const remoteRoundVersionsRef = useRef(new Map())
  const remoteClubBagSignatureRef = useRef(null)
  const clubOnboardingCompletedRef = useRef(false)
  const clubDistanceCanonicalInputsRef = useRef({})
  const lastTrackedScreenRef = useRef(null)
  const lastTrackedOnboardingStepRef = useRef(null)
  const completedOnboardingStepsRef = useRef(new Set())
  const analyticsSyncIssueStagesRef = useRef(new Set())

  const unseenNews = hasUnseenNews(lastSeenNewsId)

  function reportDiagnosticFailure(stage, error) {
    if (!session || isPreviewMode) return
    const diagnostic = recordDiagnosticFailure({ stage, error, online: navigator.onLine })
    if (diagnostic) enqueueDiagnosticFailure(diagnostic.record)
  }

  function reportDiagnosticRecovery(stage) {
    if (!session || isPreviewMode) return
    resolveDiagnosticFailures(stage).forEach(record => enqueueDiagnosticRecovery(record))
  }

  async function runDiagnosticSmokeTest() {
    if (!session || !isDiagnosticSmokeMode || diagnosticSmokeStatus === 'sending') return
    setDiagnosticSmokeStatus('sending')
    const diagnostic = recordDiagnosticFailure({
      stage: 'api_call',
      error: { status: 503 },
      online: navigator.onLine,
    })
    if (!diagnostic) {
      setDiagnosticSmokeStatus('error')
      return
    }
    enqueueDiagnosticFailure(diagnostic.record)
    await flushDiagnosticQueue()
    await new Promise(resolve => window.setTimeout(resolve, 500))
    resolveDiagnosticFailures('api_call').forEach(record => enqueueDiagnosticRecovery(record))
    const sent = await flushDiagnosticQueue()
    setDiagnosticSmokeStatus(sent ? 'sent' : 'queued')
  }

  function updateAnalyticsConsent(granted) {
    setAnalyticsConsentState(setAnalyticsConsent(granted))
  }

  function trackOnboardingStepComplete(step) {
    if (completedOnboardingStepsRef.current.has(step)) return false
    const tracked = trackEvent('onboarding_step', { step, status: 'complete' })
    if (tracked) completedOnboardingStepsRef.current.add(step)
    return tracked
  }

  function trackSaveDelayed(stage, online) {
    if (analyticsSyncIssueStagesRef.current.has(stage)) return false
    const tracked = trackEvent('save_delayed', { stage, online })
    if (tracked) analyticsSyncIssueStagesRef.current.add(stage)
    return tracked
  }

  function trackSaveRecovered(stage) {
    const wasTracked = analyticsSyncIssueStagesRef.current.delete(stage)
    return wasTracked ? trackEvent('save_recovered', { stage, online: true }) : false
  }

  useEffect(() => {
    if (!session) {
      setLastSeenNewsId(null)
      return
    }
    setLastSeenNewsId(window.localStorage.getItem(newsSeenStorageKey(session.user.id)))
  }, [session])

  useEffect(() => {
    if (!session || !isOnline || isPreviewMode) return
    void flushDiagnosticQueue()
  }, [session?.user?.id, isOnline])

  useEffect(() => {
    lastTrackedScreenRef.current = null
    lastTrackedOnboardingStepRef.current = null
    completedOnboardingStepsRef.current.clear()
    analyticsSyncIssueStagesRef.current.clear()
  }, [session?.user?.id])

  useEffect(() => {
    if (analyticsConsent === 'granted' && analyticsAddressReady) {
      initializeAnalytics()
      flushPendingLoginMeasurements()
    }
  }, [analyticsConsent, analyticsAddressReady])

  useEffect(() => {
    if (analyticsConsent !== 'granted') {
      lastTrackedScreenRef.current = null
      lastTrackedOnboardingStepRef.current = null
      return
    }
    const rawScreen = session ? (onboardingReady ? screen : null) : 'login'
    const analyticsScreen = analyticsScreenNames[rawScreen] || rawScreen
    if (!analyticsScreen || lastTrackedScreenRef.current === analyticsScreen) return
    trackScreen(analyticsScreen)
    lastTrackedScreenRef.current = analyticsScreen
  }, [analyticsConsent, session, onboardingReady, screen])

  useEffect(() => {
    if (analyticsConsent !== 'granted' || screen !== 'onboarding') return
    const viewKey = `${onboardingStep}`
    if (lastTrackedOnboardingStepRef.current === viewKey) return
    trackEvent('onboarding_step', { step: onboardingStep, status: 'viewed' })
    lastTrackedOnboardingStepRef.current = viewKey
  }, [analyticsConsent, screen, onboardingStep])

  useEffect(() => {
    const layerOpen = accountOpen || accountDeletionOpen || dateTimeOpen || clubSetupPromptOpen || Boolean(roundPendingDeletion) || Boolean(pendingStructureChange) || Boolean(pendingRoundStart) || roundCompletionOpen
    if (!layerOpen) return undefined
    const previouslyFocused = document.activeElement
    const focusTimer = window.setTimeout(() => {
      document.querySelector('.account-layer .close-button, .account-layer button:not(.account-backdrop)')?.focus()
    }, 0)
    function closeOnEscape(event) {
      if (event.key !== 'Escape') return
      if (roundPendingDeletion) setRoundPendingDeletion(null)
      else if (clubSetupPromptOpen) setClubSetupPromptOpen(false)
      else if (pendingStructureChange) setPendingStructureChange(null)
      else if (pendingRoundStart) setPendingRoundStart(null)
      else if (roundCompletionOpen) setRoundCompletionOpen(false)
      else if (dateTimeOpen) setDateTimeOpen(false)
      else if (accountDeletionOpen && accountDeletionStatus !== 'deleting') setAccountDeletionOpen(false)
      else if (accountOpen) setAccountOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', closeOnEscape)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [accountOpen, accountDeletionOpen, accountDeletionStatus, dateTimeOpen, clubSetupPromptOpen, roundPendingDeletion, pendingStructureChange, pendingRoundStart, roundCompletionOpen])

  useEffect(() => {
    function updateConnectionState() {
      setIsOnline(navigator.onLine)
    }
    window.addEventListener('online', updateConnectionState)
    window.addEventListener('offline', updateConnectionState)
    return () => {
      window.removeEventListener('online', updateConnectionState)
      window.removeEventListener('offline', updateConnectionState)
    }
  }, [])

  useEffect(() => {
    if (!isOnline) remoteHydrationRetryAttemptsRef.current = 0
  }, [isOnline])

  useEffect(() => {
    if (!session || !supabase || isPreviewMode) return
    const userId = session.user.id
    function refreshRoundDeletionState() {
      if (!navigator.onLine || document.visibilityState === 'hidden') return
      setRemoteRoundsHydratedUserId(current => current === userId ? null : current)
    }
    window.addEventListener('online', refreshRoundDeletionState)
    window.addEventListener('focus', refreshRoundDeletionState)
    document.addEventListener('visibilitychange', refreshRoundDeletionState)
    return () => {
      window.removeEventListener('online', refreshRoundDeletionState)
      window.removeEventListener('focus', refreshRoundDeletionState)
      document.removeEventListener('visibilitychange', refreshRoundDeletionState)
    }
  }, [session])

  useEffect(() => {
    if (!session) {
      setClubBagHydrated(false)
      clubOnboardingCompletedRef.current = false
      return
    }
    clubOnboardingCompletedRef.current = false
    setClubDrafts(initialClubDrafts)
    setInactiveClubDrafts([])
    setClubDistanceSets([])
    setRecentlyChangedClubIds([])
    setClubDistanceBasis(null)
    setClubDistanceUnit('M')
    setClubCompositionCompleted(false)
    setClubCompositionEditing(false)
    setClubBagUpdatedAt(null)
    const storageKey = `golf-and-me:club-bag:${session.user.id}`
    const storedValue = window.localStorage.getItem(storageKey)
    if (storedValue) {
      try {
        const stored = JSON.parse(storedValue)
        if (Array.isArray(stored.clubs)) setClubDrafts(stored.clubs)
        if (Array.isArray(stored.inactiveClubs)) setInactiveClubDrafts(stored.inactiveClubs)
        if (Array.isArray(stored.distanceSets)) {
          setClubDistanceSets(stored.distanceSets)
          setClubDistanceBasis(stored.distanceSets[0]?.basis ?? null)
        }
        setClubCompositionCompleted(Boolean(stored.compositionCompleted ?? stored.distanceSets?.length))
        setClubBagUpdatedAt(stored.updatedAt || null)
        if (['M', 'YD'].includes(stored.distanceUnit)) setClubDistanceUnit(stored.distanceUnit)
      } catch {
        window.localStorage.removeItem(storageKey)
      }
    }
    setClubBagHydrated(true)
  }, [session])

  useEffect(() => {
    if (!session || !clubBagHydrated) return
    window.localStorage.setItem(`golf-and-me:club-bag:${session.user.id}`, JSON.stringify({
      clubs: clubDrafts,
      inactiveClubs: inactiveClubDrafts,
      distanceUnit: clubDistanceUnit,
      distanceSets: clubDistanceSets,
      compositionCompleted: clubCompositionCompleted,
      updatedAt: clubBagUpdatedAt,
    }))
  }, [session, clubBagHydrated, clubDrafts, inactiveClubDrafts, clubDistanceUnit, clubDistanceSets, clubCompositionCompleted, clubBagUpdatedAt])

  useEffect(() => {
    if (isPreviewMode) return
    if (!supabase) return

    const callbackError = authCallbackError(window.location.href)

    supabase.auth.getSession().then(({ data, error }) => {
      clearAuthCallbackFromAddress(window)
      setAnalyticsAddressReady(true)
      if (data.session) {
        setAuthError('')
      }
      else if (shouldReportAuthCallbackFailure(callbackError, data.session)) {
        recordLoginFailure('oauth_callback')
        const previewDetail = import.meta.env.VITE_APP_ENV === 'preview' ? ` (${callbackError})` : ''
        setAuthError(`Google 로그인이 완료되지 않았습니다. 다시 시도해주세요.${previewDetail}`)
      }
      else if (error) setAuthError('로그인 상태를 확인하지 못했습니다. 다시 시도해주세요.')
      setSession(data.session)
      setAuthLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession) {
        setAuthError('')
        measureLoginStage('session_restored')
      }
      setSession(currentSession => currentSession?.user?.id === nextSession?.user?.id ? currentSession : nextSession)
      setAuthLoading(false)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setOnboardingReady(false)
      setRemoteProfileHydratedUserId(null)
      setRemoteRoundsHydratedUserId(null)
      setRemoteClubBagHydratedUserId(null)
      remoteHydrationRetryAttemptsRef.current = 0
      recordsReadyMeasuredUserIdRef.current = null
      remoteRoundVersionsRef.current = new Map()
      remoteClubBagSignatureRef.current = null
      setRounds([])
      setActiveRound(null)
      setCourseHistory([])
      setNavigationReady(false)
      setPendingDeletedRoundIds([])
      setObservedRoundTombstones([])
      return
    }

    setOnboardingReady(false)
    setRemoteProfileHydratedUserId(null)
    setRemoteRoundsHydratedUserId(null)
    setRemoteClubBagHydratedUserId(null)
    remoteHydrationRetryAttemptsRef.current = 0
    recordsReadyMeasuredUserIdRef.current = null
    remoteRoundVersionsRef.current = new Map()
    remoteClubBagSignatureRef.current = null
    setRounds([])
    setActiveRound(null)
    setCourseHistory([])
    setNavigationReady(false)
    setRestoreHoleNumber(null)
    setResumeNotice('')
    setDefaultTee('화이트')
    setDefaultDistanceUnit('M')
    setRound(newRoundForm())
    const queuedDeletionIds = loadPendingRoundDeletions(window.localStorage, session.user.id)
    const cachedTombstones = loadObservedRoundTombstones(window.localStorage, session.user.id)
    setPendingDeletedRoundIds(queuedDeletionIds)
    setObservedRoundTombstones(cachedTombstones)

    const storageKey = `golf-and-me:onboarding:${session.user.id}`
    let savedProfile = isPreviewOnboardingMode ? null : window.localStorage.getItem(storageKey)
    if (isPreviewMode && !isPreviewOnboardingMode && !savedProfile) {
      savedProfile = JSON.stringify({ defaultTee: '화이트', defaultDistanceUnit: 'M' })
      window.localStorage.setItem(storageKey, savedProfile)
    }
    const profile = savedProfile ? JSON.parse(savedProfile) : null
    if (profile) {
      setDefaultTee(profile.defaultTee || '화이트')
      setDefaultDistanceUnit(profile.defaultDistanceUnit || 'M')
      setRound(current => ({ ...current, tee: profile.defaultTee || '화이트', distanceUnit: profile.defaultDistanceUnit || 'M' }))
    }

    const roundsKey = `golf-and-me:rounds:${session.user.id}`
    const previewSeedKey = `golf-and-me:preview-rounds-version:${session.user.id}`
    let savedRounds = window.localStorage.getItem(roundsKey)
    if (isPreviewMode) {
      let existingRounds = []
      try { existingRounds = savedRounds ? JSON.parse(savedRounds) : [] } catch { existingRounds = [] }
      const versionChanged = window.localStorage.getItem(previewSeedKey) !== PREVIEW_ROUNDS_VERSION
      const refreshIds = versionChanged ? ['preview-lakeside-high-score', 'preview-trinity-manual-draft'] : []
      savedRounds = JSON.stringify(mergePreviewRounds(existingRounds, refreshIds))
      window.localStorage.setItem(roundsKey, savedRounds)
      window.localStorage.setItem(previewSeedKey, PREVIEW_ROUNDS_VERSION)
    } else if (!savedRounds) {
      const savedRound = window.localStorage.getItem(`golf-and-me:active-round:${session.user.id}`)
      if (savedRound) savedRounds = JSON.stringify([JSON.parse(savedRound)])
    }
    const loadedRounds = excludePendingRoundDeletions(
      savedRounds ? JSON.parse(savedRounds) : [],
      roundDeletionIds(queuedDeletionIds, cachedTombstones),
    )
    clearDeletedRoundLocalArtifacts(
      window.localStorage,
      session.user.id,
      roundDeletionIds(queuedDeletionIds, cachedTombstones),
    )
    window.localStorage.setItem(roundsKey, JSON.stringify(loadedRounds))
    setRounds(loadedRounds)
    const navigationKey = `golf-and-me:navigation:${session.user.id}`
    let checkpoint = null
    try { checkpoint = JSON.parse(window.localStorage.getItem(navigationKey)) } catch { window.localStorage.removeItem(navigationKey) }
    const checkpointRound = loadedRounds.find(item => item.id === checkpoint?.roundId)
    if (checkpointRound && ['round-result', 'scorecard', 'hole-detail'].includes(checkpoint?.screen)) {
      setActiveRound(checkpointRound)
      setScreen(checkpoint.screen === 'round-result' ? 'round-result' : 'scorecard')
      if (checkpoint.screen === 'hole-detail' && checkpointRound.holes.some(hole => hole.holeNumber === checkpoint.holeNumber)) {
        setRestoreHoleNumber(checkpoint.holeNumber)
      } else {
        setResumeNotice(`${checkpointRound.courseName} 스코어카드를 이어서 보여드려요`)
      }
    } else if (checkpoint?.screen === 'clubs' && profile) {
      setClubStage(checkpoint.clubStage === 'composition' ? 'composition' : 'distance')
      setScreen('clubs')
    } else if (profile) {
      setScreen('home')
    }
    const savedCourses = window.localStorage.getItem(`golf-and-me:course-history:${session.user.id}`)
    setCourseHistory(savedCourses ? JSON.parse(savedCourses) : [])

    if (profile || isPreviewMode || !supabase) {
      if (!profile) {
        setScreen('onboarding')
        setOnboardingStep(1)
      }
      setOnboardingReady(true)
    } else {
      setScreen('onboarding')
      setOnboardingStep(1)
    }
    setNavigationReady(true)
  }, [session])

  useEffect(() => {
    if (!session || !clubBagHydrated || isPreviewMode || !supabase) return
    const userId = session.user.id
    const needsProfile = remoteProfileHydratedUserId !== userId
    const needsRounds = remoteRoundsHydratedUserId !== userId
    const needsClubBag = remoteClubBagHydratedUserId !== userId
    if (!needsProfile && !needsRounds && !needsClubBag) return
    let cancelled = false
    let cancelRemoteHydrationRetry = null

    async function hydrateRemoteData() {
      const settle = promise => promise.then(value => ({ value }), error => ({ error }))
      const [profileResult, roundsResult, clubBagResult] = await Promise.all([
        needsProfile ? settle(loadRemoteProfile(supabase, userId)) : { skipped: true },
        needsRounds ? settle(loadRemoteRoundSyncState(supabase, userId)) : { skipped: true },
        needsClubBag ? settle(loadRemoteClubBag(supabase, userId)) : { skipped: true },
      ])
      if (cancelled) return

      let profileFailed = false
      let roundsFailed = false
      let clubBagFailed = false

      if (needsProfile) {
        if (profileResult.error) {
          profileFailed = true
          reportDiagnosticFailure('profile_load', profileResult.error)
          const hasLocalProfile = Boolean(window.localStorage.getItem(`golf-and-me:onboarding:${userId}`))
          if (!hasLocalProfile) {
            setScreen('onboarding')
            setOnboardingStep(1)
          }
        } else {
          try {
            const localProfileValue = window.localStorage.getItem(`golf-and-me:onboarding:${userId}`)
            const localProfile = localProfileValue ? JSON.parse(localProfileValue) : null
            const resolvedProfile = resolveOnboardingProfile(localProfile, profileResult.value)
            let profileSaveFailed = false
            if (resolvedProfile.shouldSaveRemote) {
              try {
                await saveRemoteProfile(supabase, userId, {
                  defaultTee: resolvedProfile.defaultTee,
                  defaultDistanceUnit: resolvedProfile.defaultDistanceUnit,
                })
                reportDiagnosticRecovery('profile_save')
              } catch (error) {
                profileSaveFailed = true
                profileFailed = true
                reportDiagnosticFailure('profile_save', error)
              }
            }
            if (cancelled) return
            if (resolvedProfile.completed) {
              window.localStorage.setItem(`golf-and-me:onboarding:${userId}`, JSON.stringify({
                defaultTee: resolvedProfile.defaultTee,
                defaultDistanceUnit: resolvedProfile.defaultDistanceUnit,
              }))
              setDefaultTee(resolvedProfile.defaultTee)
              setDefaultDistanceUnit(resolvedProfile.defaultDistanceUnit)
              setRound(current => ({ ...current, tee: resolvedProfile.defaultTee, distanceUnit: resolvedProfile.defaultDistanceUnit }))
              setScreen(current => current === 'onboarding' ? 'home' : current)
            } else {
              setScreen('onboarding')
              setOnboardingStep(1)
            }
            if (!profileSaveFailed) setRemoteProfileHydratedUserId(userId)
            reportDiagnosticRecovery('profile_load')
          } catch (error) {
            profileFailed = true
            reportDiagnosticFailure('profile_load', error)
          }
        }
      }
      setOnboardingReady(true)

      if (needsRounds) {
        if (roundsResult.error) {
          roundsFailed = true
          reportDiagnosticFailure('rounds_load', roundsResult.error)
        } else {
          const mergedTombstones = mergeObservedRoundTombstones(
            observedRoundTombstones,
            roundsResult.value.tombstones,
          )
          const deletedRoundIds = roundDeletionIds(pendingDeletedRoundIds, mergedTombstones)
          const deletedRoundIdSet = new Set(deletedRoundIds)
          saveObservedRoundTombstones(window.localStorage, userId, mergedTombstones)
          clearDeletedRoundLocalArtifacts(window.localStorage, userId, deletedRoundIds)
          setObservedRoundTombstones(mergedTombstones)
          remoteRoundVersionsRef.current = createRemoteRoundVersionMap(roundsResult.value.rounds)
          setRounds(currentRounds => {
            const mergedRounds = mergeRoundCollectionsWithDeletions(
              currentRounds,
              roundsResult.value.rounds,
              deletedRoundIds,
            )
            window.localStorage.setItem(`golf-and-me:rounds:${userId}`, JSON.stringify(mergedRounds))
            setActiveRound(currentRound => {
              if (currentRound && deletedRoundIdSet.has(String(currentRound.id))) {
                setHoleDraft(null)
                setEditingActiveRound(false)
                setScreen('home')
                return null
              }
              return currentRound
                ? mergedRounds.find(item => item.id === currentRound.id) || currentRound
                : currentRound
            })
            return mergedRounds
          })
          setRemoteRoundsHydratedUserId(userId)
          reportDiagnosticRecovery('rounds_load')
        }
      }

      if (needsClubBag) {
        if (clubBagResult.error) {
          clubBagFailed = true
          reportDiagnosticFailure('club_bag_load', clubBagResult.error)
        } else {
          remoteClubBagSignatureRef.current = clubBagSyncSignature(clubBagResult.value)
          const clubStorageKey = `golf-and-me:club-bag:${userId}`
          let localClubBag = { clubs: [], inactiveClubs: [], distanceUnit: 'M', distanceSets: [], compositionCompleted: false, updatedAt: null }
          try {
            const storedClubBag = window.localStorage.getItem(clubStorageKey)
            if (storedClubBag) localClubBag = { ...localClubBag, ...JSON.parse(storedClubBag) }
          } catch {
            window.localStorage.removeItem(clubStorageKey)
          }
          const resolvedClubBag = resolveClubBag(localClubBag, clubBagResult.value)
          if (!clubOnboardingCompletedRef.current) {
            setClubDrafts(resolvedClubBag.clubs)
            setInactiveClubDrafts(resolvedClubBag.inactiveClubs)
            setClubDistanceSets(resolvedClubBag.distanceSets)
            setClubDistanceUnit(resolvedClubBag.distanceUnit)
            setClubDistanceBasis(resolvedClubBag.distanceSets[0]?.basis ?? null)
            setClubCompositionCompleted(resolvedClubBag.compositionCompleted)
            setClubBagUpdatedAt(resolvedClubBag.updatedAt)
            window.localStorage.setItem(clubStorageKey, JSON.stringify(resolvedClubBag))
          }
          setRemoteClubBagHydratedUserId(userId)
          reportDiagnosticRecovery('club_bag_load')
        }
      }

      const profileReady = !needsProfile || !profileFailed
      const roundsReady = !needsRounds || !roundsFailed
      const clubBagReady = !needsClubBag || !clubBagFailed
      if (roundsReady && clubBagReady && recordsReadyMeasuredUserIdRef.current !== userId) {
        recordsReadyMeasuredUserIdRef.current = userId
        measureLoginStage('records_ready')
      }

      if (profileReady && roundsReady && clubBagReady) {
        remoteHydrationRetryAttemptsRef.current = 0
        setSyncError('')
        if (hadSyncIssueRef.current) {
          hadSyncIssueRef.current = false
          setSyncRecoveredNotice('기록을 최신 상태로 저장했어요.')
          trackSaveRecovered('remote_load')
        }
        return
      }

      hadSyncIssueRef.current = true
      trackSaveDelayed('remote_load', navigator.onLine)
      const willRetry = shouldScheduleRemoteHydrationRetry(remoteHydrationRetryAttemptsRef.current, navigator.onLine)
      setSyncError(willRetry
        ? '일부 계정 기록을 불러오지 못했어요. 이 기기의 기록으로 계속할 수 있고, 잠시 후 한 번 더 시도할게요.'
        : '일부 계정 기록을 불러오지 못했어요. 이 기기의 기록은 안전하며, 인터넷 연결을 확인한 뒤 새로고침해 주세요.')
      if (willRetry) {
        remoteHydrationRetryAttemptsRef.current += 1
        cancelRemoteHydrationRetry = scheduleRemoteHydrationRetry(window, () => {
          setRemoteHydrationRetryNonce(value => value + 1)
        })
      }
    }

    hydrateRemoteData()
    return () => {
      cancelled = true
      cancelRemoteHydrationRetry?.()
    }
  }, [session, clubBagHydrated, remoteProfileHydratedUserId, remoteRoundsHydratedUserId, remoteClubBagHydratedUserId, isOnline, pendingDeletedRoundIds, observedRoundTombstones, remoteHydrationRetryNonce])

  useEffect(() => {
    if (!session || !supabase || isPreviewMode) return
    if (remoteRoundsHydratedUserId !== session.user.id || remoteClubBagHydratedUserId !== session.user.id) return
    if (!isOnline) {
      hadSyncIssueRef.current = true
      setSyncError('인터넷 연결이 없어요. 입력은 이 기기에 안전하게 저장하고 있으며, 연결되면 계정에도 자동 저장됩니다.')
      trackSaveDelayed('offline', false)
      return
    }
    analyticsSyncIssueStagesRef.current.delete('offline')
    let retryTimer = null
    const timer = window.setTimeout(async () => {
      const deletedRoundIds = roundDeletionIds(pendingDeletedRoundIds, observedRoundTombstones)
      const roundsToSave = selectRoundsNeedingRemoteSave(
        rounds,
        remoteRoundVersionsRef.current,
        deletedRoundIds,
      )
      const currentClubBag = {
        clubs: clubDrafts,
        inactiveClubs: inactiveClubDrafts,
        distanceSets: clubDistanceSets,
        compositionCompleted: clubCompositionCompleted,
        distanceUnit: clubDistanceUnit,
        updatedAt: clubBagUpdatedAt,
      }
      const currentClubBagSignature = clubBagSyncSignature(currentClubBag)
      const clubBagNeedsSave = currentClubBagSignature !== remoteClubBagSignatureRef.current
      try {
        const deletionResults = []
        for (const roundId of pendingDeletedRoundIds) {
          try {
            const tombstone = await deleteRemoteRound(supabase, session.user.id, roundId)
            deletionResults.push({ roundId: String(roundId), tombstone })
          } catch (error) {
            deletionResults.push({ roundId: String(roundId), error })
          }
        }
        const successfulDeletions = deletionResults.filter(result => !result.error)
        const failedDeletions = deletionResults.filter(result => result.error)
        if (successfulDeletions.length) {
          const successfulIds = new Set(successfulDeletions.map(result => result.roundId))
          const nextObserved = mergeObservedRoundTombstones(
            observedRoundTombstones,
            successfulDeletions.map(result => result.tombstone),
          )
          const remainingPending = pendingDeletedRoundIds.filter(id => !successfulIds.has(String(id)))
          saveObservedRoundTombstones(window.localStorage, session.user.id, nextObserved)
          savePendingRoundDeletions(window.localStorage, session.user.id, remainingPending)
          setObservedRoundTombstones(nextObserved)
          setPendingDeletedRoundIds(remainingPending)
          successfulIds.forEach(roundId => remoteRoundVersionsRef.current.delete(roundId))
        }
        const roundsDeleteError = failedDeletions[0]?.error || null
        const [roundsSaveResult, clubBagSaveResult] = await Promise.all([
          saveRemoteRounds(supabase, session.user.id, roundsToSave, deletedRoundIds)
            .then(() => ({ ok: true }), error => ({ error })),
          (clubBagNeedsSave ? saveRemoteClubBag(supabase, session.user.id, currentClubBag) : Promise.resolve())
            .then(() => ({ ok: true }), error => ({ error })),
        ])
        if (roundsSaveResult.error) reportDiagnosticFailure('rounds_save', roundsSaveResult.error)
        if (roundsDeleteError) reportDiagnosticFailure('rounds_delete', roundsDeleteError)
        if (clubBagSaveResult.error) reportDiagnosticFailure('club_bag_save', clubBagSaveResult.error)
        if (!roundsSaveResult.error) {
          remoteRoundVersionsRef.current = markRoundsAsRemoteSaved(remoteRoundVersionsRef.current, roundsToSave)
          reportDiagnosticRecovery('rounds_save')
        }
        if (!roundsDeleteError) {
          reportDiagnosticRecovery('rounds_delete')
        }
        if (!clubBagSaveResult.error) {
          if (clubBagNeedsSave) remoteClubBagSignatureRef.current = currentClubBagSignature
          reportDiagnosticRecovery('club_bag_save')
        }
        if (isRoundTombstonedError(roundsSaveResult.error)) setRemoteRoundsHydratedUserId(null)
        if (roundsSaveResult.error) throw roundsSaveResult.error
        if (roundsDeleteError) throw roundsDeleteError
        if (clubBagSaveResult.error) throw clubBagSaveResult.error
        setSyncError('')
        if (hadSyncIssueRef.current) {
          hadSyncIssueRef.current = false
          setSyncRecoveredNotice('기록을 최신 상태로 저장했어요.')
          trackSaveRecovered('remote_save')
        }
      } catch {
        hadSyncIssueRef.current = true
        setSyncError('입력은 이 기기에 안전하게 저장됐어요. 계정 저장이 늦어지고 있지만 자동으로 다시 시도할게요. 계속 기록해도 괜찮아요.')
        trackSaveDelayed('remote_save', navigator.onLine)
        retryTimer = window.setTimeout(() => setSyncRetryNonce(value => value + 1), 5000)
      }
    }, 500)
    return () => {
      window.clearTimeout(timer)
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [rounds, clubDrafts, inactiveClubDrafts, clubDistanceSets, clubCompositionCompleted, clubDistanceUnit, clubBagUpdatedAt, pendingDeletedRoundIds, observedRoundTombstones, session, remoteRoundsHydratedUserId, remoteClubBagHydratedUserId, isOnline, syncRetryNonce])

  useEffect(() => {
    if (!restoreHoleNumber || !activeRound) return
    const hole = activeRound.holes.find(item => item.holeNumber === restoreHoleNumber)
    setRestoreHoleNumber(null)
    if (!hole) return
    openHole(hole)
    setResumeNotice(`${holeDisplayNumber(hole)}번 홀 작성 내용을 자동 저장해 이어서 보여드려요`)
  }, [restoreHoleNumber, activeRound])

  useEffect(() => {
    if (!navigationReady || !session) return
    const navigationKey = `golf-and-me:navigation:${session.user.id}`
    const checkpoint = screen === 'hole-detail' && activeRound && holeDraft
      ? { screen, roundId: activeRound.id, holeNumber: holeDraft.holeNumber, savedAt: new Date().toISOString() }
      : ['round-result', 'scorecard'].includes(screen) && activeRound
        ? { screen, roundId: activeRound.id, savedAt: new Date().toISOString() }
        : screen === 'clubs'
          ? { screen, clubStage, savedAt: new Date().toISOString() }
          : { screen: 'home', savedAt: new Date().toISOString() }
    window.localStorage.setItem(navigationKey, JSON.stringify(checkpoint))
  }, [navigationReady, screen, session, activeRound, holeDraft?.holeNumber, clubStage])

  useEffect(() => {
    if (!resumeNotice) return
    const timer = window.setTimeout(() => setResumeNotice(''), 3500)
    return () => window.clearTimeout(timer)
  }, [resumeNotice])

  useEffect(() => {
    if (!syncRecoveredNotice) return
    const timer = window.setTimeout(() => setSyncRecoveredNotice(''), 3000)
    return () => window.clearTimeout(timer)
  }, [syncRecoveredNotice])

  useEffect(() => {
    if (!activeRound) return
    const legacyCourse = !activeRound.courseId && activeRound.courseTemplateId ? findKnownCourse(activeRound.courseName) : null
    const templatedRound = applyKnownCourseTemplate(legacyCourse ? { ...activeRound, courseId: legacyCourse.id, distanceUnit: activeRound.distanceUnit || 'M' } : activeRound)
    if (templatedRound === activeRound) return
    const updatedRound = syncStoredHoleDrafts(activeRound, { ...templatedRound, updatedAt: new Date().toISOString() })
    const nextRounds = rounds.map(item => item.id === updatedRound.id ? updatedRound : item)
    window.localStorage.setItem(`golf-and-me:rounds:${session.user.id}`, JSON.stringify(nextRounds))
    setActiveRound(updatedRound)
    setRounds(nextRounds)
  }, [activeRound, session, rounds])

  useEffect(() => {
    if (!accountOpen && !dateTimeOpen) return
    function closeOnEscape(event) {
      if (event.key === 'Escape') setAccountOpen(false)
      if (event.key === 'Escape') setDateTimeOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [accountOpen, dateTimeOpen])

  useEffect(() => {
    if (screen !== 'hole-detail' || holeMode !== 'draft' || !holeDraft || !session || !activeRound) return
    persistHoleDraft(holeDraft)
  }, [holeDraft, holeMode, screen, session, activeRound?.id])

  useEffect(() => {
    if (screen !== 'hole-detail' || holeMode !== 'draft' || !holeDraft || !session || !activeRound) return
    function flushHoleDraft() {
      persistHoleDraft(holeDraft)
    }
    function saveWhenHidden() {
      if (document.visibilityState === 'hidden') flushHoleDraft()
    }
    window.addEventListener('pagehide', flushHoleDraft)
    document.addEventListener('visibilitychange', saveWhenHidden)
    return () => {
      window.removeEventListener('pagehide', flushHoleDraft)
      document.removeEventListener('visibilitychange', saveWhenHidden)
    }
  }, [holeDraft, holeMode, screen, session, activeRound?.id])

  async function signInWithGoogle() {
    if (!supabase) return
    setAuthError('')
    setAuthLoading(true)
    startLoginMeasurement()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: googleOAuthOptions(window.location.origin),
    })
    if (error) {
      recordLoginFailure('oauth_start')
      reportDiagnosticFailure('oauth', error)
      setAuthError('Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.')
      setAuthLoading(false)
    }
  }

  function openNews() {
    const currentLatestNewsId = latestNewsId()
    if (session && currentLatestNewsId) {
      window.localStorage.setItem(newsSeenStorageKey(session.user.id), currentLatestNewsId)
      setLastSeenNewsId(currentLatestNewsId)
    }
    setAccountOpen(false)
    setScreen('news')
  }

  function openFeedback() {
    setAccountOpen(false)
    setFeedbackStatus('idle')
    setFeedbackError('')
    setScreen('feedback')
  }

  async function submitFeedback(event) {
    event.preventDefault()
    const message = feedbackMessage.trim()
    if (!message || feedbackStatus === 'sending') return
    setFeedbackStatus('sending')
    setFeedbackError('')
    try {
      await sendFeedback(message, session.access_token)
      setFeedbackMessage('')
      setFeedbackStatus('sent')
    } catch (error) {
      setFeedbackError(error.message)
      setFeedbackStatus('idle')
    }
  }

  async function signOut() {
    if (!supabase) return
    const signingOutUserId = session?.user?.id
    setAuthError('')
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) setAuthError('로그아웃하지 못했습니다. 다시 시도해주세요.')
    else {
      clearDiagnosticQueue()
      resetNavigationForExplicitSignOut(window.localStorage, signingOutUserId)
      setAccountOpen(false)
      setScreen('home')
    }
  }

  function openAccountDeletion() {
    setAccountOpen(false)
    setAccountDeletionError('')
    setAccountDeletionStatus('idle')
    setAccountDeletionOpen(true)
  }

  async function deleteAccount() {
    if (!supabase || !session || accountDeletionStatus === 'deleting') return
    setAccountDeletionError('')
    setAccountDeletionStatus('deleting')
    const userId = session.user.id
    const { error } = await deleteRemoteAccount(supabase)
    if (error) {
      reportDiagnosticFailure('account_delete', error)
      setAccountDeletionStatus('idle')
      setAccountDeletionError('계정을 삭제하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.')
      return
    }
    reportDiagnosticRecovery('account_delete')
    clearLocalUserData(window.localStorage, userId)
    await supabase.auth.signOut({ scope: 'local' })
    setAccountDeletionOpen(false)
    setAccountDeletionStatus('idle')
    setRounds([])
    setActiveRound(null)
    setSession(null)
    setScreen('home')
    trackEvent('account_delete_complete', { status: 'success' })
  }

  function completeOnboarding() {
    const storageKey = `golf-and-me:onboarding:${session.user.id}`
    window.localStorage.setItem(storageKey, JSON.stringify({ defaultTee, defaultDistanceUnit }))
    setRound(current => ({ ...current, tee: defaultTee, distanceUnit: defaultDistanceUnit }))
    setClubSetupReturn(null)
    setScreen('home')
    trackOnboardingStepComplete(3)
    trackEvent('onboarding_complete', { status: 'complete' })
    if (supabase && !isPreviewMode) {
      saveRemoteProfile(supabase, session.user.id, { defaultTee, defaultDistanceUnit })
        .then(() => reportDiagnosticRecovery('profile_save'))
        .catch(error => {
          reportDiagnosticFailure('profile_save', error)
          setSyncError('기본 티 설정은 기기에 저장했지만 서버 동기화가 지연되고 있어요.')
        })
    }
  }

  function completeOnboardingWithClubs() {
    const updatedAt = new Date().toISOString()
    const nextClubBag = {
      clubs: clubDrafts,
      inactiveClubs: inactiveClubDrafts,
      distanceUnit: clubDistanceUnit,
      distanceSets: clubDistanceSets,
      compositionCompleted: true,
      updatedAt,
    }
    clubOnboardingCompletedRef.current = true
    window.localStorage.setItem(`golf-and-me:club-bag:${session.user.id}`, JSON.stringify(nextClubBag))
    setClubBagUpdatedAt(updatedAt)
    setClubCompositionCompleted(true)
    setClubCompositionEditing(false)
    trackEvent('club_setup_complete', { status: 'saved', source: 'onboarding' })
    if (supabase && !isPreviewMode) {
      saveRemoteClubBag(supabase, session.user.id, nextClubBag).catch(() => {
        setSyncError('클럽 구성은 이 기기에 저장했지만 계정 저장이 늦어지고 있어요. 잠시 후 자동으로 다시 시도할게요.')
      })
    }
    completeOnboarding()
  }

  function createRound(event) {
    event.preventDefault()
    if (!round.courseName.trim() || !round.frontCourseName.trim() || !round.backCourseName.trim()) return
    const structuralChange = Boolean(editingActiveRound && activeRound && (
      activeRound.courseId !== round.courseId
      || activeRound.courseName !== round.courseName.trim()
      || activeRound.frontCourseName !== round.frontCourseName.trim()
      || activeRound.backCourseName !== round.backCourseName.trim()
    ))
    if (structuralChange && roundStructureLocked) return
    if (needsRoundStructureChoice(structuralChange, roundHasRecordedData, roundStructureLocked)) {
      setPendingStructureChange({ inputCount: enteredHoles.length + holeDraftProgress.length })
      return
    }
    const roundRecord = buildRoundRecord(false)
    if (!editingActiveRound && roundRecord.courseId) {
      setPendingRoundStart(roundRecord)
      return
    }
    commitRoundRecord(roundRecord, false)
  }

  function buildRoundRecord(resetHoles) {
    const courseName = round.courseName.trim()
    const frontCourseName = round.frontCourseName.trim()
    const backCourseName = round.backCourseName.trim()
    const sourceHoles = editingActiveRound && activeRound && !resetHoles ? activeRound.holes : emptyRoundHoles()
    let roundRecord = {
      ...(editingActiveRound && activeRound ? activeRound : {}),
      id: editingActiveRound && activeRound ? activeRound.id : createLocalId(),
      courseName,
      courseId: round.courseId,
      frontCourseName,
      backCourseName,
      courseNameDetail: `${frontCourseName} / ${backCourseName}`,
      tee: round.tee,
      distanceUnit: round.distanceUnit || 'M',
      playedAt: round.playedAt,
      companionMemo: round.companionMemo.trim(),
      status: editingActiveRound && activeRound ? activeRound.status : 'in_progress',
      createdAt: editingActiveRound && activeRound ? activeRound.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      draftHoles: resetHoles ? {} : (editingActiveRound && activeRound ? activeRound.draftHoles || {} : {}),
      holes: sourceHoles,
    }
    if (!round.courseId && editingActiveRound && activeRound?.courseId) {
      roundRecord = {
        ...roundRecord,
        courseTemplateId: null,
        holes: roundRecord.holes.map(hole => ({
          ...hole,
          par: hole.parSource === 'course_database' ? null : hole.par,
          parSource: hole.parSource === 'course_database' ? null : hole.parSource,
          sourcePar: null,
          distance: hole.distanceSource === 'course_database' ? 0 : hole.distance,
          distanceSource: hole.distanceSource === 'course_database' ? null : hole.distanceSource,
          sourceDistanceMeters: null,
          sourceDistanceYards: null,
          sourceOfficialHole: null,
        })),
      }
    }
    const templatedRound = applyKnownCourseTemplate(roundRecord)
    return {
      ...templatedRound,
      holes: templatedRound.holes.map(hole => {
        if (!Number.isFinite(hole.score) || !Number.isFinite(hole.par) || !hole.shots?.length || !Number.isFinite(hole.putts)) return hole
        const totals = calculateHoleTotals(hole.shots, hole.putts)
        const teeShot = totals.usedShots[0]
        if (!teeShot) return hole
        return {
          ...hole,
          fir: hole.par === 3 ? null : !teeShot.troubleType,
          gir: hole.puttingStartLie !== 'fringe' && totals.swingCount + totals.penaltyStrokes <= hole.par - 2,
        }
      }),
    }
  }

  function commitRoundRecord(roundRecord, resetHoles) {
    let committedRound = roundRecord
    const courseName = committedRound.courseName
    const frontCourseName = committedRound.frontCourseName
    const backCourseName = committedRound.backCourseName
    if (resetHoles && activeRound) clearStoredHoleDrafts(activeRound)
    if (!resetHoles && editingActiveRound && activeRound && activeRound.courseTemplateId !== committedRound.courseTemplateId) {
      committedRound = syncStoredHoleDrafts(activeRound, committedRound)
    }
    const nextCourseHistory = [
      { courseName, frontCourseName, backCourseName },
      ...courseHistory.filter(item => !(
        item.courseName.toLocaleLowerCase() === courseName.toLocaleLowerCase()
        && item.frontCourseName.toLocaleLowerCase() === frontCourseName.toLocaleLowerCase()
        && item.backCourseName.toLocaleLowerCase() === backCourseName.toLocaleLowerCase()
      )),
    ].slice(0, 20)
    window.localStorage.setItem(`golf-and-me:course-history:${session.user.id}`, JSON.stringify(nextCourseHistory))
    const nextRounds = [committedRound, ...rounds.filter(item => item.id !== committedRound.id)]
    window.localStorage.setItem(`golf-and-me:rounds:${session.user.id}`, JSON.stringify(nextRounds))
    setCourseHistory(nextCourseHistory)
    setRounds(nextRounds)
    setActiveRound(committedRound)
    setEditingActiveRound(false)
    setPendingStructureChange(null)
    setScreen(committedRound.status === 'completed' ? 'round-result' : 'scorecard')
    if (!editingActiveRound) trackEvent('round_create', {
      is_manual_course: !committedRound.courseId,
      has_course_data: Boolean(committedRound.courseId),
    })
  }

  function applyStructureChange(resetHoles) {
    commitRoundRecord(buildRoundRecord(resetHoles), resetHoles)
  }

  function clearStoredHoleDrafts(roundRecord) {
    roundRecord.holes.forEach(hole => {
      window.localStorage.removeItem(`golf-and-me:hole-draft:${session.user.id}:${roundRecord.id}:${hole.holeNumber}`)
    })
  }

  function startNewRound() {
    if (!clubCompositionCompleted) {
      setClubSetupPromptOpen(true)
      return
    }
    setRound(newRoundForm(defaultTee, defaultDistanceUnit))
    setEditingActiveRound(false)
    setPendingRoundStart(null)
    setScreen('new-round')
  }

  function openClubBag() {
    setAccountOpen(false)
    setClubStage(clubCompositionCompleted ? 'distance' : 'composition')
    setClubCompositionEditing(false)
    setCustomClubCategory(null)
    setClubDistanceEditing(false)
    setRecentlyChangedClubIds([])
    setClubSetupReturn(null)
    setScreen('clubs')
  }

  function toggleClubDraft(category, value) {
    const id = `${category}:${value}`
    setClubBagUpdatedAt(new Date().toISOString())
    const selectedClub = clubDrafts.find(club => club.id === id)
    if (selectedClub) {
      setClubDrafts(current => current.filter(club => club.id !== id))
      setInactiveClubDrafts(current => [...current.filter(club => club.id !== id), selectedClub])
      return
    }
    const inactiveClub = inactiveClubDrafts.find(club => club.id === id)
    setInactiveClubDrafts(current => current.filter(club => club.id !== id))
    setClubDrafts(current => [...current, inactiveClub || { id, category, value, label: clubLabel(category, value), custom: false }])
  }

  function addCustomClub(event) {
    event.preventDefault()
    const label = customClubLabel.trim()
    if (!label || !customClubCategory) return
    if (clubDrafts.some(club => club.label.toLocaleLowerCase() === label.toLocaleLowerCase())) return
    setClubBagUpdatedAt(new Date().toISOString())
    const inactiveClub = inactiveClubDrafts.find(club => club.category === customClubCategory && club.label.toLocaleLowerCase() === label.toLocaleLowerCase())
    if (inactiveClub) setInactiveClubDrafts(current => current.filter(club => club.id !== inactiveClub.id))
    setClubDrafts(current => [...current, inactiveClub || { id: createLocalId(), category: customClubCategory, value: label, label, custom: true }])
    setCustomClubLabel('')
    setCustomClubCategory(null)
  }

  function removeCustomClub(id) {
    setClubBagUpdatedAt(new Date().toISOString())
    const selectedClub = clubDrafts.find(club => club.id === id)
    setClubDrafts(current => current.filter(club => club.id !== id))
    if (selectedClub) setInactiveClubDrafts(current => [...current.filter(club => club.id !== id), selectedClub])
  }

  function togglePutter() {
    setClubBagUpdatedAt(new Date().toISOString())
    const selectedPutter = clubDrafts.find(club => club.category === '퍼터')
    if (selectedPutter) {
      setClubDrafts(current => current.filter(club => club.category !== '퍼터'))
      setInactiveClubDrafts(current => [...current.filter(club => club.id !== selectedPutter.id), selectedPutter])
      return
    }
    const inactivePutter = inactiveClubDrafts.find(club => club.category === '퍼터')
    if (inactivePutter) setInactiveClubDrafts(current => current.filter(club => club.id !== inactivePutter.id))
    setClubDrafts(current => [...current, inactivePutter || { id: '퍼터:PT', category: '퍼터', value: 'PT', label: 'PT', custom: false }])
  }

  function openClubDistances() {
    const isFirstComposition = !clubCompositionCompleted
    setClubBagUpdatedAt(new Date().toISOString())
    setClubCompositionCompleted(true)
    trackEvent('club_setup_complete', { status: 'saved', source: clubSetupReturn === 'onboarding' ? 'onboarding' : 'account' })
    setClubCompositionEditing(false)
    setClubStage(isFirstComposition ? 'distance' : 'composition')
    setCustomClubCategory(null)
    setClubDistanceEditing(false)
    if (clubSetupReturn === 'new-round') {
      setClubSetupReturn(null)
      setRound(newRoundForm(defaultTee, defaultDistanceUnit))
      setEditingActiveRound(false)
      setPendingRoundStart(null)
      setScreen('new-round')
    }
  }

  function beginDistanceUpdate() {
    const latestSet = clubDistanceSets[0]
    if (latestSet) {
      setClubDistanceUnit(latestSet.unit || 'M')
      setClubDistanceBasis(latestSet.basis ?? null)
      clubDistanceCanonicalInputsRef.current = Object.fromEntries(clubDrafts
        .filter(club => club.category !== '퍼터')
        .map(club => {
          const normalized = Number(latestSet.distancesM?.[club.id])
          if (Number.isFinite(normalized)) return [club.id, normalized]
          const distance = latestSet.distances?.[club.id]
          return [club.id, distance == null ? null : distanceToMeters(distance, latestSet.unit)]
        })
        .filter(([, value]) => Number.isFinite(value)))
    } else {
      clubDistanceCanonicalInputsRef.current = {}
    }
    setClubDistanceInputs({})
    setClubDistanceEditing(true)
  }

  function updateClubDistanceInput(clubId, value) {
    setClubDistanceInputs(current => ({ ...current, [clubId]: value }))
    if (value === '') delete clubDistanceCanonicalInputsRef.current[clubId]
    else clubDistanceCanonicalInputsRef.current[clubId] = distanceToMeters(value, clubDistanceUnit)
  }

  function changeClubDistanceUnit(nextUnit) {
    if (nextUnit === clubDistanceUnit) return
    setClubDistanceInputs(Object.fromEntries(Object.entries(clubDistanceCanonicalInputsRef.current)
      .filter(([, value]) => Number.isFinite(value))
      .map(([clubId, value]) => [clubId, String(distanceFromMeters(value, nextUnit))])))
    setClubDistanceUnit(nextUnit)
  }

  function changeClubDistanceBasis(nextBasis) {
    if (nextBasis === clubDistanceBasis) return
    const latestSet = clubDistanceSets[0]
    if (latestSet && latestSet.basis === nextBasis) {
      clubDistanceCanonicalInputsRef.current = Object.fromEntries(clubDrafts
        .filter(club => club.category !== '퍼터')
        .map(club => {
          const normalized = Number(latestSet.distancesM?.[club.id])
          if (Number.isFinite(normalized)) return [club.id, normalized]
          const distance = latestSet.distances?.[club.id]
          return [club.id, distance == null ? null : distanceToMeters(distance, latestSet.unit)]
        })
        .filter(([, value]) => Number.isFinite(value)))
    } else {
      clubDistanceCanonicalInputsRef.current = {}
    }
    setClubDistanceInputs({})
    setClubDistanceBasis(nextBasis)
  }

  function cancelDistanceUpdate() {
    const latestSet = clubDistanceSets[0]
    if (latestSet) {
      setClubDistanceUnit(latestSet.unit || 'M')
      setClubDistanceBasis(latestSet.basis ?? null)
    }
    clubDistanceCanonicalInputsRef.current = {}
    setClubDistanceInputs({})
    setClubDistanceEditing(false)
  }

  function saveDistanceSet(event) {
    event.preventDefault()
    const nextSet = createDistanceSet({
      clubs: clubDrafts,
      inputs: clubDistanceInputs,
      normalizedInputs: clubDistanceCanonicalInputsRef.current,
      previousSet: clubDistanceSets[0],
      basis: clubDistanceBasis,
      unit: clubDistanceUnit,
      id: createLocalId(),
      recordedAt: new Date().toISOString(),
    })
    if (!nextSet) return
    setClubDistanceSets(current => [nextSet, ...current])
    setRecentlyChangedClubIds(nextSet.changedClubIds)
    clubDistanceCanonicalInputsRef.current = {}
    setClubDistanceInputs({})
    setClubDistanceEditing(false)
  }

  async function openRound(selectedRound) {
    let resolvedRound = selectedRound
    if (selectedRound.remoteSummaryOnly && supabase && session && !isPreviewMode) {
      try {
        const remoteRound = await loadRemoteRoundDetail(supabase, session.user.id, selectedRound.id)
        if (!remoteRound) {
          const tombstone = await loadRemoteRoundTombstone(supabase, session.user.id, selectedRound.id)
          if (tombstone) {
            const nextObserved = mergeObservedRoundTombstones(observedRoundTombstones, [tombstone])
            const deletedIds = roundDeletionIds(pendingDeletedRoundIds, nextObserved)
            const nextRounds = excludePendingRoundDeletions(rounds, deletedIds)
            saveObservedRoundTombstones(window.localStorage, session.user.id, nextObserved)
            clearDeletedRoundLocalArtifacts(window.localStorage, session.user.id, deletedIds)
            window.localStorage.setItem(`golf-and-me:rounds:${session.user.id}`, JSON.stringify(nextRounds))
            setObservedRoundTombstones(nextObserved)
            setRounds(nextRounds)
            setActiveRound(null)
            setHoleDraft(null)
            setEditingActiveRound(false)
            setScreen('home')
            setSyncError('다른 기기에서 삭제한 기록을 이 기기에서도 반영했어요.')
            return
          }
          throw new Error('Round detail not found')
        }
        resolvedRound = remoteRound
        const nextRounds = rounds.map(item => item.id === remoteRound.id ? remoteRound : item)
        window.localStorage.setItem(`golf-and-me:rounds:${session.user.id}`, JSON.stringify(nextRounds))
        setRounds(nextRounds)
        setSyncError('')
        reportDiagnosticRecovery('rounds_load')
      } catch (error) {
        reportDiagnosticFailure('rounds_load', error)
        setSyncError('라운드 상세 기록을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 열어주세요.')
        return
      }
    }
    setActiveRound(resolvedRound)
    setEditingActiveRound(false)
    setScreen(resolvedRound.status === 'completed' ? 'round-result' : 'scorecard')
    if (resolvedRound.status === 'completed') trackEvent('round_result_view', { completed_holes: 18 })
  }

  function requestRoundDeletion(selectedRound) {
    setRoundPendingDeletion(selectedRound)
  }

  function deleteRound() {
    if (!roundPendingDeletion) return
    roundPendingDeletion.holes.forEach(hole => {
      window.localStorage.removeItem(`golf-and-me:hole-draft:${session.user.id}:${roundPendingDeletion.id}:${hole.holeNumber}`)
    })
    const nextRounds = rounds.filter(item => item.id !== roundPendingDeletion.id)
    window.localStorage.setItem(`golf-and-me:rounds:${session.user.id}`, JSON.stringify(nextRounds))
    if (activeRound?.id === roundPendingDeletion.id) {
      setActiveRound(null)
      setHoleDraft(null)
      setEditingActiveRound(false)
      setScreen('home')
    }
    setRounds(nextRounds)
    const deletedRoundId = String(roundPendingDeletion.id)
    const nextPendingDeletedRoundIds = savePendingRoundDeletions(window.localStorage, session.user.id, [...pendingDeletedRoundIds, deletedRoundId])
    setPendingDeletedRoundIds(nextPendingDeletedRoundIds)
    setRoundPendingDeletion(null)
    if (!navigator.onLine) {
      setSyncError('기기에서는 삭제했어요. 온라인이 되면 계정 기록에서도 삭제하도록 자동으로 다시 시도할게요.')
    }
  }

  function openActiveRoundInfo() {
    if (!activeRound) return
    setRound({
      courseId: activeRound.courseId || null,
      courseName: activeRound.courseName || '',
      frontCourseName: activeRound.frontCourseName || '',
      backCourseName: activeRound.backCourseName || '',
      tee: activeRound.tee || defaultTee,
      distanceUnit: activeRound.distanceUnit || 'M',
      playedAt: activeRound.playedAt || localDateTimeValue(),
      companionMemo: activeRound.companionMemo || '',
    })
    setEditingActiveRound(true)
    setScreen('new-round')
  }

  function openDateTimePicker() {
    const [date = '', time = ''] = round.playedAt.split('T')
    setDraftDate(date)
    setDraftTime(time)
    setDateTimeOpen(true)
  }

  function applyDateTime() {
    if (!draftDate || !draftTime) return
    setRound(current => ({ ...current, playedAt: `${draftDate}T${draftTime}` }))
    setDateTimeOpen(false)
  }

  function formattedPlayedAt() {
    if (!round.playedAt) return '날짜와 시간을 선택해주세요'
    const [date, time] = round.playedAt.split('T')
    const [year, month, day] = date.split('-')
    return `${year}.${month}.${day} ${time}`
  }

  const matchingCourseHistory = courseHistory.filter(item => (
    !round.courseName.trim()
    || item.courseName.toLocaleLowerCase() === round.courseName.trim().toLocaleLowerCase()
  ))
  const knownCourseSuggestions = searchKnownCourses(round.courseName)
  const selectedKnownCourse = getKnownCourse(round.courseId)
  const knownSegmentNames = segmentNamesForCourse(round.courseId)
  const frontCourseSuggestions = [...new Set(matchingCourseHistory.map(item => item.frontCourseName))]
  const backCourseSuggestions = [...new Set(matchingCourseHistory.map(item => item.backCourseName))]
  const enteredHoles = activeRound?.holes.filter(hole => Number.isFinite(hole.score)) || []
  const inProgressRounds = sortRoundsForList(rounds.filter(item => item.status !== 'completed'), 'in_progress')
  const completedRounds = sortRoundsForList(rounds.filter(item => item.status === 'completed'), 'completed')
  const cumulativeStats = calculateCumulativeStats(completedRounds)
  const enteredTotal = enteredHoles.reduce((sum, hole) => sum + hole.score, 0)
  const holesWithPar = enteredHoles.filter(hole => Number.isFinite(hole.par))
  const enteredPar = holesWithPar.reduce((sum, hole) => sum + hole.par, 0)
  const scoreToPar = holesWithPar.reduce((sum, hole) => sum + hole.score, 0) - enteredPar
  const roundStats = calculateRoundStats(activeRound)
  const distanceCoverage = getRoundDistanceCoverage(activeRound)
  const completionState = roundCompletionState(activeRound)

  function meaningfulDraftForHole(hole) {
    if (!hole || Number.isFinite(hole.score) || !session || !activeRound) return null
    const stored = window.localStorage.getItem(`golf-and-me:hole-draft:${session.user.id}:${activeRound.id}:${hole.holeNumber}`)
    let localDraft = null
    try {
      localDraft = stored ? JSON.parse(stored) : null
    } catch {
      window.localStorage.removeItem(`golf-and-me:hole-draft:${session.user.id}:${activeRound.id}:${hole.holeNumber}`)
    }
    const draft = latestHoleDraft(localDraft, activeRound.draftHoles?.[hole.holeNumber])
    if (!draft) return null
    try {
      const hasShotInput = draft.shots?.some(isRecordedShot)
      const hasPuttingInput = Number.isFinite(draft.putts) || draft.puttingDistance !== '' || draft.puttingSteps !== ''
      const hasManualCourseInput = draft.parSource === 'user' || draft.distanceSource === 'user'
      return hasShotInput || hasPuttingInput || hasManualCourseInput ? draft : null
    } catch {
      return null
    }
  }

  const holeDraftProgress = activeRound?.holes.map(hole => ({ holeNumber: hole.holeNumber, draft: meaningfulDraftForHole(hole) })).filter(item => item.draft) || []
  const roundHasRecordedData = enteredHoles.length > 0 || holeDraftProgress.length > 0
  const roundStructureLocked = Boolean(editingActiveRound && isRoundStructureLocked(activeRound, holeDraftProgress.map(item => item.holeNumber)))
  const latestDraftHoleNumber = holeDraftProgress.reduce((latest, item) => !latest || (item.draft.draftUpdatedAt || '') > (latest.draft.draftUpdatedAt || '') ? item : latest, null)?.holeNumber
  const inProgressHoleNumbers = new Set(holeDraftProgress.map(item => item.holeNumber))

  function holeAriaLabel(hole) {
    const status = inProgressHoleNumbers.has(hole.holeNumber)
      ? '입력 중'
      : Number.isFinite(hole.score) && !Number.isFinite(hole.par)
        ? '점수 입력 완료, PAR 정보가 없어 파 대비 계산 불가'
        : `파 대비 ${holeToPar(hole) ?? '입력'}`
    return `${holeDisplayNumber(hole)}번 홀 ${status}`
  }

  function holeScoreDisplay(hole) {
    if (!Number.isFinite(hole.score)) return '+'
    if (!Number.isFinite(hole.par)) return '⚠️'
    return holeToPar(hole)
  }

  function nineTotal(from, to) {
    const entered = activeRound?.holes.filter(hole => hole.holeNumber >= from && hole.holeNumber <= to && Number.isFinite(hole.score)) || []
    return entered.length ? `${entered.reduce((sum, hole) => sum + hole.score, 0)}타` : '—'
  }

  function formatToPar(value) {
    if (!Number.isFinite(value)) return '—'
    if (value === 0) return 'E'
    return value > 0 ? `+${value}` : `${value}`
  }

  function holeToPar(hole) {
    if (!Number.isFinite(hole.score) || !Number.isFinite(hole.par)) return null
    const value = hole.score - hole.par
    return value > 0 ? `+${value}` : `${value}`
  }

  function holeDisplayNumber(hole) {
    return hole.sourceOfficialHole ?? hole.holeNumber
  }

  function teeColorClass(tee) {
    return teeOptions.find(option => option.value === tee)?.color || 'white'
  }

  function compactRoundDate(value) {
    if (!value) return ''
    const [date, time = ''] = value.split('T')
    const [year, month, day] = date.split('-')
    return `${year.slice(-2)}.${month}.${day} ${time}`
  }

  function roundProgressLabel(item) {
    const entered = item.holes.filter(hole => Number.isFinite(hole.score))
    if (item.status !== 'completed') return `${entered.length}/18홀 입력`
    const stats = calculateRoundStats(item)
    return `${formatToPar(stats.toPar)} / ${stats.totalScore}타`
  }

  function missingHoleLabel() {
    const numbers = completionState.missingHoles.map(holeDisplayNumber)
    if (!numbers.length) return ''
    const visible = numbers.slice(0, 6).join(', ')
    return numbers.length > 6 ? `${visible}번 외 ${numbers.length - 6}개 홀` : `${visible}번 홀`
  }

  function shotName(index, shot) {
    if (index === 0) return '티샷'
    if (shot.provisionalFor != null) return '재샷'
    const number = index + 1
    const suffix = number % 10 === 1 && number % 100 !== 11 ? 'st' : number % 10 === 2 && number % 100 !== 12 ? 'nd' : number % 10 === 3 && number % 100 !== 13 ? 'rd' : 'th'
    return `${number}${suffix}`
  }

  function shotEntryComplete(index, shot) {
    if (!shot) return false
    if (index === 0) return Boolean(shot.club)
    return Boolean(shot.club && shot.remainingDistance !== '' && shot.remainingDistance != null)
  }

  function shotTaskLabel(index) {
    return index === 0 ? '클럽을 선택하세요' : '남은거리와 클럽을 입력하세요'
  }

  function holeDraftStorageKey(holeNumber) {
    return `golf-and-me:hole-draft:${session.user.id}:${activeRound.id}:${holeNumber}`
  }

  function persistHoleDraft(draft) {
    if (!draft || !session || !activeRound) return
    const draftUpdatedAt = new Date().toISOString()
    const savedDraft = { ...draft, draftUpdatedAt }
    window.localStorage.setItem(holeDraftStorageKey(draft.holeNumber), JSON.stringify(savedDraft))
    setActiveRound(current => current?.id === activeRound.id ? upsertRoundHoleDraft(current, savedDraft, draftUpdatedAt) : current)
    setRounds(current => {
      const nextRounds = current.map(item => item.id === activeRound.id ? upsertRoundHoleDraft(item, savedDraft, draftUpdatedAt) : item)
      window.localStorage.setItem(`golf-and-me:rounds:${session.user.id}`, JSON.stringify(nextRounds))
      return nextRounds
    })
  }

  function syncStoredHoleDrafts(previousRound, nextRound) {
    const nextDraftHoles = {}
    nextRound.holes.forEach(nextHole => {
      const draftKey = `golf-and-me:hole-draft:${session.user.id}:${nextRound.id}:${nextHole.holeNumber}`
      const storedDraft = window.localStorage.getItem(draftKey)
      let localDraft = null
      try {
        localDraft = storedDraft ? JSON.parse(storedDraft) : null
      } catch {
        window.localStorage.removeItem(draftKey)
      }
      const draft = latestHoleDraft(localDraft, previousRound.draftHoles?.[nextHole.holeNumber])
      if (!draft) return
      try {
        const previousHole = previousRound.holes.find(hole => hole.holeNumber === nextHole.holeNumber)
        const distanceWasAutomatic = draft.distanceSource === 'course_database'
          || draft.distance == null
          || draft.distance === ''
          || (previousHole && Number(draft.distance) === Number(previousHole.distance))
        const parWasAutomatic = draft.parSource === 'course_database'
          || (previousHole && draft.par === previousHole.par)
        const rebasedDraft = {
          ...draft,
          par: parWasAutomatic ? nextHole.par : draft.par,
          sourcePar: nextHole.sourcePar,
          parSource: parWasAutomatic ? 'course_database' : 'user',
          distance: distanceWasAutomatic ? nextHole.distance : draft.distance,
          distanceSource: distanceWasAutomatic ? 'course_database' : 'user',
          sourceDistanceMeters: nextHole.sourceDistanceMeters,
          sourceDistanceYards: nextHole.sourceDistanceYards,
          sourceOfficialHole: nextHole.sourceOfficialHole,
        }
        nextDraftHoles[nextHole.holeNumber] = rebasedDraft
        window.localStorage.setItem(draftKey, JSON.stringify(rebasedDraft))
      } catch {
        window.localStorage.removeItem(draftKey)
      }
    })
    return { ...nextRound, draftHoles: nextDraftHoles }
  }

  function openHole(hole) {
    const completedHole = Number.isFinite(hole.score)
    const storedDraft = completedHole ? null : window.localStorage.getItem(holeDraftStorageKey(hole.holeNumber))
    let localDraft = null
    if (storedDraft) {
      try { localDraft = JSON.parse(storedDraft) } catch { window.localStorage.removeItem(holeDraftStorageKey(hole.holeNumber)) }
    }
    const restoredDraft = completedHole ? null : latestHoleDraft(localDraft, activeRound.draftHoles?.[hole.holeNumber])
    const sourceHole = restoredDraft || hole
    const savedShots = sourceHole.shots?.length ? sourceHole.shots : []
    const shots = savedShots.map(shot => ({
      ...shot,
      troubleType: shot.troubleType === 'hazard' ? 'penalty' : shot.troubleType,
      obRelief: shot.obRelief ?? (shot.troubleType === 'ob' ? 'replay' : null),
    }))
    while (shots.length < 4) shots.push(emptyShot(shots.length + 1))
    const putts = Number.isFinite(sourceHole.putts) ? sourceHole.putts : null
    const normalizedDraft = {
      ...sourceHole,
      shots,
      putts,
      puttingDistance: sourceHole.puttingDistance ?? sourceHole.puttDetails?.[0]?.remainingDistance ?? '',
      puttingSteps: sourceHole.puttingSteps ?? sourceHole.puttDetails?.[0]?.steps ?? '',
      puttingStartLie: sourceHole.puttingStartLie ?? 'green',
    }
    setHoleDraft(normalizedDraft)
    setInitialHoleDraft(normalizedDraft)
    setHoleMode(completedHole ? 'view' : 'draft')
    setActiveShotIndex(completedHole ? null : 'all')
    setOpenTroubleRows([])
    setPuttMoreOpen(false)
    setCustomPutts(Number.isFinite(putts) && putts >= 5 ? String(putts) : '5')
    setScreen('hole-detail')
    if (!completedHole) trackEvent('hole_start', { completed_holes: enteredHoles.length })
  }

  function leaveHoleDetail() {
    if (holeMode === 'draft' && holeDraft) persistHoleDraft(holeDraft)
    setScreen('scorecard')
  }

  function saveHoleDraft() {
    if (holeDraft) persistHoleDraft(holeDraft)
    trackEvent('hole_draft_save', { completed_holes: enteredHoles.length })
    setScreen('scorecard')
  }

  function beginHoleEdit() {
    setHoleMode('edit')
    setActiveShotIndex('all')
    setOpenTroubleRows(holeDraft?.shots.reduce((rows, shot, index) => {
      if (shot.troubleDirection || shot.troubleType || shot.obRelief) rows.push(index)
      return rows
    }, []) || [])
  }

  function troubleSummary(shot) {
    const direction = shot.troubleDirection === 'left' ? '좌' : shot.troubleDirection === 'right' ? '우' : ''
    const troubleLabels = { rough: '러프', bunker: '벙커', hazard: '페널티', penalty: '페널티', ob: 'OB' }
    const reliefLabels = { replay: '재샷', forward: '전진 구제' }
    return [direction, troubleLabels[shot.troubleType], shot.troubleType === 'ob' ? reliefLabels[shot.obRelief] : null].filter(Boolean).join(' · ')
  }

  function shotSummary(index, shot) {
    const hasShotData = shot.club || (shot.remainingDistance !== '' && shot.remainingDistance != null) || shot.troubleDirection || shot.troubleType || shot.provisionalFor != null
    if (!hasShotData) return Number.isFinite(holeDraft?.score) ? '샷 없음' : '입력하기'
    const distance = index === 0 ? holeDraft.distance : shot.remainingDistance
    const direction = shot.troubleDirection === 'left' ? '좌' : shot.troubleDirection === 'right' ? '우' : ''
    const troubleLabels = { rough: '러프', bunker: '벙커', hazard: '페널티', penalty: '페널티', ob: 'OB' }
    const reliefLabels = { replay: '재샷', forward: '전진 구제' }
    const trouble = [direction, troubleLabels[shot.troubleType], shot.troubleType === 'ob' ? reliefLabels[shot.obRelief] : null].filter(Boolean).join(' · ')
    const terminalLie = terminalLieForShot(holeDraft?.shots, index, holeDraft?.putts, holeDraft?.puttingStartLie)
    return [distance ? `${distance}m` : null, shot.club, terminalLie || trouble || '페어웨이'].filter(Boolean).join(' · ')
  }

  function updateShot(index, changes) {
    setHoleDraft(current => {
      const changesDistance = Object.prototype.hasOwnProperty.call(changes, 'remainingDistance')
      const shots = current.shots.map((shot, shotIndex) => shotIndex === index
        ? { ...shot, ...changes, ...(changesDistance ? { remainingDistanceSource: 'user' } : {}) }
        : { ...shot })
      if (changesDistance && shots[index + 1]?.provisionalFor === index && shots[index + 1].remainingDistanceSource === 'replay_auto') {
        shots[index + 1].remainingDistance = changes.remainingDistance
      }
      return { ...current, shots }
    })
  }

  function updateShotClub(index, selectedValue) {
    if (!selectedValue) {
      updateShot(index, { club: '', clubId: null, clubSnapshot: null })
      return
    }
    if (selectedValue.startsWith('legacy:')) return
    const clubId = selectedValue.slice(3)
    const selectedClub = orderedActiveClubs.find(club => String(club.id) === clubId)
      || (String(holeDraft?.shots[index]?.clubId) === clubId ? holeDraft.shots[index].clubSnapshot : null)
    if (!selectedClub) return
    const clubSnapshot = {
      id: selectedClub.id ?? clubId,
      label: selectedClub.label || holeDraft?.shots[index]?.club || '',
      category: selectedClub.category || '',
      value: selectedClub.value || selectedClub.label || '',
      custom: Boolean(selectedClub.custom),
    }
    updateShot(index, { club: clubSnapshot.label, clubId: String(clubSnapshot.id), clubSnapshot })
  }

  function updateTeeDistance(value) {
    setHoleDraft(current => ({
      ...current,
      distance: value,
      distanceSource: 'user',
      shots: current.shots.map(shot => shot.provisionalFor === 0 && shot.remainingDistanceSource === 'replay_auto' ? { ...shot, remainingDistance: value } : shot),
    }))
  }

  function selectPutts(putts) {
    setHoleDraft(current => ({ ...current, putts }))
    setPuttMoreOpen(false)
  }

  function openCustomPutts() {
    setCustomPutts(Number.isFinite(holeDraft?.putts) && holeDraft.putts >= 5 ? String(holeDraft.putts) : '5')
    setPuttMoreOpen(current => !current)
  }

  function applyCustomPutts(event) {
    event.preventDefault()
    const value = Number.parseInt(customPutts, 10)
    if (!Number.isInteger(value) || value < 5) return
    selectPutts(value)
  }

  function selectTrouble(index, troubleType) {
    setHoleDraft(current => {
      const shots = current.shots.map(shot => ({ ...shot }))
      const isClearing = shots[index].troubleType === troubleType
      shots[index].troubleType = isClearing ? null : troubleType
      shots[index].obRelief = null
      if (shots[index + 1]?.provisionalFor === index) {
        if (shots[index + 1].remainingDistanceSource === 'replay_auto') {
          shots[index + 1].remainingDistance = ''
          shots[index + 1].remainingDistanceSource = null
        }
        shots[index + 1].provisionalFor = null
      }
      return { ...current, shots }
    })
  }

  function selectObRelief(index, obRelief) {
    setHoleDraft(current => {
      const shots = current.shots.map(shot => ({ ...shot }))
      shots[index].obRelief = obRelief
      if (obRelief === 'replay') {
        if (!shots[index + 1]) shots.push(emptyShot(shots.length + 1))
        const replayWasAlreadyLinked = shots[index + 1].provisionalFor === index
        shots[index + 1].provisionalFor = index
        const nextDistanceIsEmpty = shots[index + 1].remainingDistance === '' || shots[index + 1].remainingDistance == null
        if (shots[index + 1].remainingDistanceSource === 'replay_auto' || nextDistanceIsEmpty || replayWasAlreadyLinked) {
          shots[index + 1].remainingDistance = index === 0 ? current.distance : shots[index].remainingDistance
          shots[index + 1].remainingDistanceSource = 'replay_auto'
        } else if (!shots[index + 1].remainingDistanceSource) {
          shots[index + 1].remainingDistanceSource = 'user'
        }
      } else if (shots[index + 1]?.provisionalFor === index) {
        if (shots[index + 1].remainingDistanceSource === 'replay_auto') {
          shots[index + 1].remainingDistance = ''
          shots[index + 1].remainingDistanceSource = null
        }
        shots[index + 1].provisionalFor = null
      }
      return { ...current, shots }
    })
  }

  function clearTrouble(index) {
    setHoleDraft(current => {
      const shots = current.shots.map(shot => ({ ...shot }))
      shots[index] = { ...shots[index], troubleDirection: null, troubleType: null, obRelief: null }
      if (shots[index + 1]?.provisionalFor === index) {
        if (shots[index + 1].remainingDistanceSource === 'replay_auto') {
          shots[index + 1].remainingDistance = ''
          shots[index + 1].remainingDistanceSource = null
        }
        shots[index + 1].provisionalFor = null
      }
      return { ...current, shots }
    })
  }

  function removeAddedShot(index) {
    if (index < 4) return
    setHoleDraft(current => ({
      ...current,
      shots: current.shots
        .filter((_, shotIndex) => shotIndex !== index)
        .map((shot, shotIndex) => ({
          ...shot,
          sequence: shotIndex + 1,
          provisionalFor: shot.provisionalFor === index ? null : shot.provisionalFor > index ? shot.provisionalFor - 1 : shot.provisionalFor,
        })),
    }))
    setOpenTroubleRows(current => current.filter(row => row !== index).map(row => row > index ? row - 1 : row))
    setActiveShotIndex(current => current === 'all' ? current : current === index ? null : current > index ? current - 1 : current)
  }

  function saveHole() {
    const totals = validateHoleCompletion(holeDraft)
    const usedShots = totals.usedShots
    if (!totals.canFinalize) return
    const obCount = usedShots.filter(shot => shot.troubleType === 'ob').length
    const penaltyCount = usedShots.filter(shot => ['penalty', 'hazard'].includes(shot.troubleType)).length
    const teeShot = usedShots[0]
    const greenReachedIn = totals.swingCount + totals.penaltyStrokes
    const officialPutts = holeDraft.puttingStartLie === 'fringe' ? Math.max(holeDraft.putts - 1, 0) : holeDraft.putts
    const savedHole = { ...holeDraft, shots: usedShots, swingCount: totals.swingCount, obCount, penaltyCount, penaltyStrokes: totals.penaltyStrokes, score: totals.score, officialPutts, fir: holeDraft.par === 3 ? null : !teeShot.troubleType, gir: holeDraft.puttingStartLie !== 'fringe' && greenReachedIn <= holeDraft.par - 2 }
    const holeWasCompleted = activeRound.holes.some(hole => hole.holeNumber === savedHole.holeNumber && Number.isFinite(hole.score))
    const nextHoles = activeRound.holes.map(hole => hole.holeNumber === savedHole.holeNumber ? savedHole : hole)
    const nextRound = removeRoundHoleDraft({ ...activeRound, holes: nextHoles }, savedHole.holeNumber, new Date().toISOString())
    const nextRounds = rounds.map(item => item.id === nextRound.id ? nextRound : item)
    window.localStorage.setItem(`golf-and-me:rounds:${session.user.id}`, JSON.stringify(nextRounds))
    window.localStorage.removeItem(holeDraftStorageKey(savedHole.holeNumber))
    setActiveRound(nextRound)
    setRounds(nextRounds)
    setScreen(activeRound.status === 'completed' ? 'round-result' : 'scorecard')
    const completedHoles = nextHoles.filter(hole => Number.isFinite(hole.score)).length
    if (!holeWasCompleted) {
      trackEvent('hole_complete', { completed_holes: completedHoles })
      if ([1, 3, 9, 18].includes(completedHoles)) {
        trackEvent('round_milestone', { milestone: completedHoles, completed_holes: completedHoles })
      }
    }
  }

  function completeRound() {
    if (!activeRound || !roundCompletionState(activeRound).canComplete) return
    const completedAt = new Date().toISOString()
    const completedRound = clearRoundHoleDrafts({ ...activeRound, status: 'completed', completedAt }, completedAt)
    const nextRounds = rounds.map(item => item.id === completedRound.id ? completedRound : item)
    clearStoredHoleDrafts(completedRound)
    window.localStorage.setItem(`golf-and-me:rounds:${session.user.id}`, JSON.stringify(nextRounds))
    setActiveRound(completedRound)
    setRounds(nextRounds)
    setRoundCompletionOpen(false)
    setScreen('round-result')
    const roundStartedAt = Date.parse(completedRound.createdAt || '')
    const roundDurationMs = Number.isFinite(roundStartedAt) ? Math.max(0, Date.now() - roundStartedAt) : 0
    trackEvent('round_complete', { completed_holes: 18, duration_ms: roundDurationMs })
    trackEvent('round_result_view', { completed_holes: 18 })
  }

  async function submitTestAccessRequest(event) {
    event.preventDefault()
    setTestAccessStatus('submitting')
    setTestAccessError('')
    try {
      await requestTestAccess(testAccessEmail)
      setTestAccessStatus('sent')
    } catch (error) {
      setTestAccessStatus('idle')
      setTestAccessError(error.message)
    }
  }

  if (authLoading) {
    return <main className="app-shell auth-shell" aria-live="polite"><div className="spinner" aria-hidden="true" /><p role="status">로그인 상태를 확인하고 있어요.</p></main>
  }

  if (!session) {
    return (
      <main className="app-shell auth-shell">
        <div className="auth-logo"><img className="auth-ball-logo" src={golfBallLogo} alt="" /></div>
        <h1>골프와 나</h1>
        <button className="google-button" type="button" onClick={signInWithGoogle} disabled={!isSupabaseConfigured}>
          <span className="google-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48" focusable="false">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.5 0 24 0 14.6 0 6.5 5.4 2.6 13.2l8 6.2C12.4 13.7 17.7 9.5 24 9.5Z" />
              <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.1-3.8 7.2-9.4 7.2-16.4Z" />
              <path fill="#FBBC05" d="M10.5 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-8-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.2Z" />
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.3-4.5 2.1-8.8 2.1-6.3 0-11.6-4.2-13.5-9.9l-8 6.2C6.5 42.6 14.6 48 24 48Z" />
            </svg>
          </span>
          Google로 계속하기
        </button>
        <p className="legal">계속하면 서비스 이용약관 및 개인정보 처리방침에 동의하게 됩니다.</p>
        {isTestAccessRequestEnabled && (
          <section className="test-access">
            {testAccessStatus !== 'sent' && (
              <>
                <p className="test-access-label">⚠️ 처음 오신 분만!</p>
              <form className="test-access-form" onSubmit={submitTestAccessRequest}>
                <label className="test-access-email"><span>Google 계정 이메일</span>
                  <input type="email" inputMode="email" autoComplete="email" required maxLength="254" placeholder="example@gmail.com" value={testAccessEmail} onChange={event => setTestAccessEmail(event.target.value)} />
                </label>
                <input hidden type="text" name="website" tabIndex="-1" autoComplete="off" aria-hidden="true" />
                <button type="submit" disabled={testAccessStatus === 'submitting' || !testAccessEmail.trim()}>{testAccessStatus === 'submitting' ? '요청 중…' : '승인 요청'}</button>
              </form>
              {testAccessError && <p className="test-access-error error-message" role="alert">{testAccessError}</p>}
              </>
            )}
            {testAccessStatus === 'sent' && <p className="test-access-success" role="status">승인 요청을 보냈어요.</p>}
          </section>
        )}
        {!isSupabaseConfigured && <p className="setup-notice" role="status">Google 로그인을 사용하려면 <code>.env</code>에 Supabase 연결 정보를 설정해주세요.</p>}
        {authError && <p className="error-message" role="alert">{authError}</p>}
      </main>
    )
  }

  if (!onboardingReady) {
    return <main className="app-shell auth-shell" aria-live="polite"><div className="spinner" aria-hidden="true" /><p role="status">내 플레이 정보를 준비하고 있어요.</p></main>
  }

  const displayName = session.user.user_metadata?.full_name || session.user.email
  const avatarUrl = session.user.user_metadata?.avatar_url
  const puttingHasStarted = Boolean(holeDraft && !Number.isFinite(holeDraft.putts) && (holeDraft.puttingDistance !== '' || holeDraft.puttingSteps !== ''))
  const currentShotIndex = holeDraft && Number.isFinite(holeDraft.par) && !Number.isFinite(holeDraft.putts) && !puttingHasStarted
    ? holeDraft.shots.findIndex((shot, index) => !shotEntryComplete(index, shot))
    : -1
  const holeCompletion = holeDraft ? validateHoleCompletion(holeDraft) : null
  const holeCanFinalize = Boolean(holeCompletion?.canFinalize)
  const showHoleDistanceWarning = Boolean(holeMode !== 'view' && holeNeedsManualDistance(activeRound, holeDraft))
  const holeHasChanges = Boolean(holeDraft && initialHoleDraft && JSON.stringify(holeDraft) !== JSON.stringify(initialHoleDraft))
  const orderedActiveClubs = clubDrafts.filter(club => club.category !== '퍼터').sort(compareClubOrder)
  const orderedClubDrafts = [...clubDrafts].sort(compareClubOrder)
  const clubCompositionGroups = [...clubSelectionRows.map(row => row.category), '퍼터']
    .map(category => ({ category, clubs: orderedClubDrafts.filter(club => club.category === category) }))
    .filter(group => group.clubs.length)
  function shotClubOptions(shot) {
    const options = orderedActiveClubs.map(club => ({ value: `id:${club.id}`, label: club.label }))
    if (shot?.clubId && !orderedActiveClubs.some(club => String(club.id) === String(shot.clubId))) {
      options.unshift({ value: `id:${shot.clubId}`, label: `${shot.clubSnapshot?.label || shot.club} · 과거 사용 클럽` })
    } else if (!shot?.clubId && shot?.club) {
      options.unshift({ value: `legacy:${shot.club}`, label: `${shot.club} · 이전 기록` })
    }
    return options
  }

  function shotClubValue(shot) {
    if (shot?.clubId) return `id:${shot.clubId}`
    return shot?.club ? `legacy:${shot.club}` : ''
  }
  const latestDistanceSet = clubDistanceSets[0] || null
  const distanceClubs = orderedActiveClubs
  const distanceClubPairs = pairClubsForColumnLayout(distanceClubs)
  const distanceUnitChanged = Boolean(latestDistanceSet && latestDistanceSet.unit !== clubDistanceUnit)
  const distanceBasisChanged = Boolean(latestDistanceSet && latestDistanceSet.basis !== clubDistanceBasis)
  const hasDistanceChanges = Object.values(clubDistanceInputs).some(value => value !== '' && value != null)

  if (screen === 'onboarding') {
    return (
      <main className="app-shell onboarding-shell">
        {analyticsConsent === 'unknown' && (
          <section className="analytics-consent-prompt" aria-labelledby="analytics-consent-title">
            <strong id="analytics-consent-title">서비스 개선에 도움을 주실래요?</strong>
            <p>이용 흐름과 오류 발생 여부만 수집하며 계정·골프 기록은 보내지 않아요.</p>
            <div className="analytics-consent-actions">
              <button className="primary" type="button" onClick={() => updateAnalyticsConsent(true)}>허용</button>
              <button className="secondary-button" type="button" onClick={() => updateAnalyticsConsent(false)}>괜찮아요</button>
            </div>
            <small>선택하지 않아도 계속 이용할 수 있고, 내 계정에서 언제든 바꿀 수 있어요.</small>
          </section>
        )}
        <div className="onboarding-progress" aria-label={`온보딩 ${onboardingStep}/3 단계`}>
          <span className="active" /><span className={onboardingStep >= 2 ? 'active' : ''} /><span className={onboardingStep >= 3 ? 'active' : ''} />
        </div>
        {onboardingStep === 1 ? (
          <section className="onboarding-content">
            <div className="welcome-mark">G</div>
            <p className="eyebrow">Welcome to Golf &amp; Me</p>
            <h1>골프와 나에<br />오신 것을 환영합니다.</h1>
            <p className="description">당신의 골프 성장 여정을 시작해볼게요.<br />기록은 가볍게, 변화는 선명하게.</p>
            <button className="primary" type="button" onClick={() => {
              setOnboardingStep(2)
              trackOnboardingStepComplete(1)
            }}>시작하기</button>
          </section>
        ) : (
          <section className="onboarding-content onboarding-play-criteria">
            <button className="back" type="button" onClick={() => setOnboardingStep(1)}>← 이전</button>
            <p className="eyebrow">내 플레이 기준</p>
            <h1>주로 어떤 티에서<br />플레이하시나요?</h1>
            <p className="description">새 라운드를 만들 때 기본으로 선택해드려요. 나중에 언제든 바꿀 수 있습니다.</p>
            <div className="tee-options" role="radiogroup" aria-label="기본 티그라운드">
              {teeOptions.map(tee => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={defaultTee === tee.value}
                  className={`tee-option ${defaultTee === tee.value ? 'selected' : ''}`}
                  key={tee.value}
                  onClick={() => setDefaultTee(tee.value)}
                >
                  <span className={`tee-color ${tee.color}`}>{tee.symbol}</span>
                  <strong>{tee.value}티</strong>
                  <span className="tee-check">{defaultTee === tee.value ? '✓' : ''}</span>
                </button>
              ))}
            </div>
            <div className="onboarding-distance-unit" role="group" aria-labelledby="onboarding-distance-unit-label">
              <span className="onboarding-distance-unit-label" id="onboarding-distance-unit-label">주로 사용하는<br />거리 단위</span>
              <div role="radiogroup" aria-label="기본 거리 단위">
                {['M', 'YD'].map(unit => <button type="button" role="radio" aria-checked={defaultDistanceUnit === unit} className={defaultDistanceUnit === unit ? 'selected' : ''} key={unit} onClick={() => setDefaultDistanceUnit(unit)}>{unit === 'M' ? '미터 M' : '야드 YD'}</button>)}
              </div>
            </div>
            <button className="primary" type="button" onClick={() => {
              setOnboardingStep(3)
              trackOnboardingStepComplete(2)
              setClubSetupReturn('onboarding')
              setClubStage('composition')
              setClubCompositionEditing(true)
              setScreen('clubs')
            }}>다음</button>
          </section>
        )}
      </main>
    )
  }

  return (
    <main className="app-shell">
      {screen === 'home' && (
        <header className="app-header">
          <div className="brand"><img className="brand-ball-logo" src={golfBallLogo} alt="" /><span className="brand-wordmark">Golf<br />&amp; Me</span></div>
          <div className="home-header-actions">
            <button className="news-header-button" type="button" onClick={openNews} aria-label={unseenNews ? '새소식, 새 글 있음' : '새소식'}>
              <MegaphoneIcon />
              <span>새소식{unseenNews && <i className="news-unseen-dot" aria-hidden="true" />}</span>
            </button>
            <button className="profile-button" type="button" onClick={() => setAccountOpen(true)} title="계정 메뉴" aria-label={`${displayName} 계정 메뉴 열기`}>
              {avatarUrl
                ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" />
                : displayName?.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
      )}
      {authError && <p className="error-message" role="alert">{authError}</p>}
      {syncError && <p className="sync-message" role="status">{syncError}</p>}
      {syncRecoveredNotice && <p className="sync-recovered-notice" role="status">{syncRecoveredNotice}</p>}
      {resumeNotice && <p className="resume-notice" role="status">{resumeNotice}</p>}

      {screen === 'home' && (
        <section className="home">
          <h1>
            {rounds.length > 0
              ? <>오늘의 라운드도<br />기록해 볼까요?</>
              : <>라운드 기록을<br />시작해 볼까요?</>}
          </h1>
          <p className="description">기록은 간단하게, 분석은 깊이 있게.</p>
          <button className="primary" type="button" onClick={startNewRound}>새 라운드 기록하기</button>
          {rounds.length > 0 && <section className="home-report" aria-labelledby="home-report-title">
            <div className="home-report-heading">
              <h2 id="home-report-title">나의 라운드 리포트</h2>
              {cumulativeStats.roundCount > 0 && <span>완료 기록 기준</span>}
            </div>
            {cumulativeStats.roundCount > 0 ? (
              <div className="home-report-grid">
                <div><strong>{cumulativeStats.averageScore.toFixed(1)}타</strong><span>평균 스코어</span></div>
                <div><strong>{cumulativeStats.bestScore}타</strong><span>베스트 스코어</span></div>
                <div><strong>{cumulativeStats.roundCount}</strong><span>총 라운드</span></div>
                <div><strong>{formatPercent(cumulativeStats.firHits, cumulativeStats.firAttempts)}</strong><span>FIR 평균</span></div>
                <div><strong>{formatPercent(cumulativeStats.girHits, cumulativeStats.girAttempts)}</strong><span>GIR 평균</span></div>
                <div><strong>{cumulativeStats.averagePutts === null ? '—' : cumulativeStats.averagePutts.toFixed(1)}</strong><span>평균 퍼팅</span></div>
              </div>
            ) : (
              <div className="home-report-empty">
                <strong>아직 완료한 라운드가 없어요</strong>
                <span>18홀 기록을 마치면 여기에 누적 통계를 보여드려요.</span>
              </div>
            )}
          </section>}
          {rounds.length ? <div className="round-lists">
            {inProgressRounds.length > 0 && <section className="round-list" aria-labelledby="draft-rounds-title">
              <div className="round-list-heading"><h2 id="draft-rounds-title">작성 중인 기록</h2><span>{inProgressRounds.length}건</span></div>
              {inProgressRounds.map(item => <div className="round-list-card" key={item.id}>
                <button className="round-card-main" type="button" onClick={() => openRound(item)}>
                  <span className="status-pill">기록 중</span><strong>{item.courseName}</strong>
                  <span>{compactCoursePair(item.frontCourseName, item.backCourseName)} · {item.tee}티 · {compactRoundDate(item.playedAt)}</span>
                  <b>{roundProgressLabel(item)} <i aria-hidden="true">→</i></b>
                </button>
                <button className="round-delete-button" type="button" onClick={() => requestRoundDeletion(item)} aria-label={`${item.courseName} 작성 중 기록 삭제`}><TrashIcon /></button>
              </div>)}
            </section>}
            {completedRounds.length > 0 && <section className="round-list completed-rounds" aria-labelledby="completed-rounds-title">
              <div className="round-list-heading"><h2 id="completed-rounds-title">완료한 기록</h2><span>{completedRounds.length}건</span></div>
              {completedRounds.map(item => <div className="round-list-card" key={item.id}><button className="round-card-main" type="button" onClick={() => openRound(item)}>
                <span className="status-pill completed">완료</span><strong>{item.courseName}</strong>
                <span>{compactCoursePair(item.frontCourseName, item.backCourseName)} · {item.tee}티 · {compactRoundDate(item.playedAt)}</span>
                <b>{roundProgressLabel(item)} <i aria-hidden="true">→</i></b>
              </button></div>)}
            </section>}
          </div> : (
            <div className="empty-card">
              <strong>아직 기록된 라운드가 없어요</strong>
              <span>첫 라운드를 기록하면 플레이 통계를 보여드릴게요.</span>
            </div>
          )}
        </section>
      )}

      {screen === 'news' && (
        <section className="news-page">
          <div className="compact-page-header">
            <button className="back" type="button" onClick={() => setScreen('home')} aria-label="홈으로 돌아가기">←</button>
            <div className="compact-page-title"><h1>새소식</h1><span>골프와 나의 달라진 점을 전해요</span></div>
          </div>
          <div className="news-list">
            {newsItems.map(item => <article className="news-item" key={item.id}>
              <div className="news-meta"><span>{item.category}</span><time dateTime={item.date}>{item.date.replaceAll('-', '.')}</time></div>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </article>)}
          </div>
        </section>
      )}

      {screen === 'feedback' && (
        <section className="feedback-page">
          <div className="compact-page-header">
            <button className="back" type="button" onClick={() => setScreen('home')} aria-label="홈으로 돌아가기">←</button>
            <div className="compact-page-title"><h1>의견 보내기</h1><span>사용하면서 느낀 점을 편하게 남겨주세요</span></div>
          </div>
          {feedbackStatus === 'sent' ? <div className="feedback-success" role="status">
            <strong>의견을 보내주셔서 고마워요.</strong>
            <span>보내주신 내용은 서비스를 다듬는 데 참고할게요.</span>
            <button className="primary" type="button" onClick={() => setScreen('home')}>홈으로</button>
          </div> : <form className="feedback-form" onSubmit={submitFeedback}>
            <label htmlFor="feedback-message">의견</label>
            <small className="feedback-privacy-note">이메일과 계정 정보는 운영 채널에 보내지 않아요.</small>
            <textarea id="feedback-message" rows="7" maxLength={MAX_FEEDBACK_LENGTH} value={feedbackMessage} onChange={event => setFeedbackMessage(event.target.value)} placeholder="불편했던 점이나 있으면 좋을 기능을 알려주세요." />
            <span className="feedback-count">{feedbackMessage.length}/{MAX_FEEDBACK_LENGTH}</span>
            {feedbackError && <p className="error-message" role="alert">{feedbackError}</p>}
            <button className="primary" type="submit" disabled={!feedbackMessage.trim() || feedbackStatus === 'sending'}>{feedbackStatus === 'sending' ? '보내는 중…' : '의견 보내기'}</button>
          </form>}
        </section>
      )}

      {screen === 'clubs' && (
        <section className={`club-bag ${clubSetupReturn === 'onboarding' ? 'onboarding-club-bag' : ''}`}>
          {clubSetupReturn === 'onboarding' && <div className="onboarding-progress club-onboarding-progress" aria-label="온보딩 3/3 단계">
            <span className="active" /><span className="active" /><span className="active" />
          </div>}
          {clubSetupReturn === 'onboarding' ? <>
            <button className="back onboarding-back" type="button" onClick={() => {
              setClubSetupReturn(null)
              setOnboardingStep(2)
              setScreen('onboarding')
            }}>← 이전</button>
            <div className="onboarding-club-intro">
              <p className="eyebrow">내 골프백</p>
              <h1>사용하는 클럽을<br />알려주세요.</h1>
              <p className="description">라운드에서 샷과 클럽별 기록을 남길 때 사용해요.<br />언제든 변경할 수 있습니다.</p>
            </div>
          </> : <div className="compact-page-header">
            <button className="back" onClick={() => {
              if (clubSetupReturn === 'new-round') {
                setClubSetupReturn(null)
                setScreen('home')
              } else if (clubSetupReturn === 'new-round-distance') {
                setClubSetupReturn(null)
                setScreen('new-round')
              } else if (clubStage === 'composition' && clubCompositionCompleted && clubCompositionEditing) setClubCompositionEditing(false)
              else if (clubStage === 'composition' && clubCompositionCompleted) setClubStage('distance')
              else setScreen('home')
            }} aria-label={clubSetupReturn === 'new-round' ? '홈으로 돌아가기' : clubSetupReturn === 'new-round-distance' ? '새 라운드로 돌아가기' : clubStage === 'composition' && clubCompositionCompleted ? (clubCompositionEditing ? '클럽 구성 보기로 돌아가기' : '비거리로 돌아가기') : '홈으로 돌아가기'}>←</button>
            <div className="compact-page-title">
              <h1>내 골프백</h1>
              <span>{clubStage === 'composition' ? '라운드에서 사용하는 클럽을 선택해요' : '현재 내 클럽의 비거리를 세트로 관리해요'}</span>
            </div>
          </div>}

          {!clubSetupReturn && <div className="club-stage-tabs" role="tablist" aria-label="골프백 관리 메뉴">
            <button type="button" role="tab" aria-selected={clubStage === 'composition'} className={clubStage === 'composition' ? 'active' : ''} onClick={() => { setClubStage('composition'); setClubCompositionEditing(false); setRecentlyChangedClubIds([]) }}>클럽 구성</button>
            <button type="button" role="tab" aria-selected={clubStage === 'distance'} className={clubStage === 'distance' ? 'active' : ''} disabled={!clubCompositionCompleted} onClick={() => { setClubStage('distance'); setClubCompositionEditing(false); setRecentlyChangedClubIds([]) }}>클럽별 비거리</button>
          </div>}

          {clubStage === 'composition' && clubCompositionCompleted && !clubCompositionEditing ? <>
            <div className="club-composition-heading">
              <div><strong>현재 클럽 구성</strong><span>라운드에서 선택할 수 있는 클럽이에요.</span></div>
              <b>{clubDrafts.length}<small>개</small></b>
            </div>
            <div className="club-selection-table club-composition-summary">
              {clubCompositionGroups.map(group => <div className="club-selection-row" key={group.category}>
                <strong>{group.category}</strong>
                <div>{group.clubs.map(club => <span className="club-summary-chip" key={club.id}>{club.label}</span>)}</div>
              </div>)}
            </div>
            <button className="secondary-button club-edit-button" type="button" onClick={() => setClubCompositionEditing(true)}>클럽 수정하기</button>
          </> : clubStage === 'composition' ? <>
            <div className="club-composition-heading">
              <div className="club-selection-guidance"><i aria-hidden="true">i</i><span>클럽을 눌러 골프백에 넣거나 뺄 수 있어요.</span></div>
              <b>{clubDrafts.length}<small>개</small></b>
            </div>
            <div className="club-selection-table">
              {clubSelectionRows.map(row => <div className="club-selection-row" key={row.category}>
                <strong>{row.category}</strong>
                <div>
                  {row.options.map(value => {
                    const id = `${row.category}:${value}`
                    const selected = clubDrafts.some(club => club.id === id)
                    return <button type="button" className={selected ? 'selected' : ''} aria-pressed={selected} key={value} onClick={() => toggleClubDraft(row.category, value)}>{value}</button>
                  })}
                  {clubDrafts.filter(club => club.category === row.category && (club.custom || !row.options.includes(club.value))).map(club => <button type="button" className="selected custom" key={club.id} onClick={() => removeCustomClub(club.id)} aria-label={`${club.label} 빼기`}>{club.label}<small>×</small></button>)}
                  <button type="button" className="custom-add" onClick={() => { setCustomClubCategory(row.category); setCustomClubLabel('') }} aria-label={`${row.category} 직접 추가`}>＋</button>
                </div>
              </div>)}
              <div className="club-selection-row putter-row">
                <strong>퍼터</strong>
                <div><button type="button" aria-pressed={clubDrafts.some(club => club.category === '퍼터')} className={clubDrafts.some(club => club.category === '퍼터') ? 'selected' : ''} onClick={togglePutter}>PT</button></div>
              </div>
            </div>

            {customClubCategory && <form className="custom-club-form" onSubmit={addCustomClub}>
              <div><strong>{customClubCategory} 직접 추가</strong><button type="button" onClick={() => setCustomClubCategory(null)} aria-label="직접 추가 닫기">×</button></div>
              <p>홀 기록에 표시할 짧은 이름을 입력해주세요.</p>
              <label>표시명<input autoFocus required maxLength="6" value={customClubLabel} onChange={event => setCustomClubLabel(event.target.value)} placeholder={customClubCategory === '웨지' ? '예: 59, UW, 58L' : '예: 3H, 11W'} /></label>
              {customClubLabel && clubDrafts.some(club => club.label.toLocaleLowerCase() === customClubLabel.trim().toLocaleLowerCase()) && <span className="custom-club-error">이미 사용 중인 표시명이에요.</span>}
              <button className="primary" type="submit" disabled={!customClubLabel.trim() || clubDrafts.some(club => club.label.toLocaleLowerCase() === customClubLabel.trim().toLocaleLowerCase())}>추가하기</button>
            </form>}

            <button className="primary club-next-button" type="button" onClick={clubSetupReturn === 'onboarding' ? completeOnboardingWithClubs : openClubDistances} disabled={!clubDrafts.length}>{clubSetupReturn === 'onboarding' ? '이 구성으로 시작하기' : clubSetupReturn === 'new-round' ? '저장하고 라운드 만들기' : clubCompositionCompleted ? '클럽 구성 저장' : '클럽 선택 완료'}</button>
          </> : <>
            {clubDistanceEditing ? <form className="distance-edit-card" onSubmit={saveDistanceSet}>
              <div className="distance-set-heading distance-edit-heading"><div className="distance-edit-guidance"><span>필요한 클럽만 입력해도 됩니다.</span><span>입력하지 않은 클럽은 이전 거리를 유지해요.</span></div><div className="distance-preferences" aria-label="새 비거리 세트의 표시 기준">
                <fieldset><legend>단위</legend><div role="radiogroup" aria-label="클럽 비거리 단위">
                  {['M', 'YD'].map(unit => <button type="button" role="radio" aria-checked={clubDistanceUnit === unit} className={clubDistanceUnit === unit ? 'selected' : ''} key={unit} onClick={() => changeClubDistanceUnit(unit)}>{unit}</button>)}
                </div></fieldset>
                <label className="distance-basis-select"><span>기준(선택)</span><select value={clubDistanceBasis ?? ''} onChange={event => changeClubDistanceBasis(event.target.value || null)} aria-label="클럽 비거리 기준"><option value="">미지정</option><option value="carry">캐리</option><option value="total">총거리</option></select></label>
              </div></div>
              {(distanceUnitChanged || distanceBasisChanged) && <div className="distance-basis-warning" role="status">
                {distanceUnitChanged && <p>단위를 {clubDistanceUnit}로 변경해 기존 비거리를 환산했어요. 저장 전에 확인해주세요.</p>}
                {distanceBasisChanged && clubDistanceBasis && <p>기준을 {clubDistanceBasis === 'carry' ? '캐리' : '총거리'}로 변경했어요. 이전 비거리는 다른 기준이므로 자동 적용하지 않아요.</p>}
                {distanceBasisChanged && !clubDistanceBasis && <p>거리 기준을 지정하지 않고 저장합니다.</p>}
              </div>}
              <div className="distance-pair-table edit">
                <div className="distance-pair-header"><span>클럽</span><span>비거리</span><span>클럽</span><span>비거리</span></div>
                {distanceClubPairs.map((pair, rowIndex) => <div className="distance-pair-row" key={rowIndex}>
                  {pair.map((club, pairIndex) => club ? <label className="distance-pair" key={club.id}>
                    <strong>{club.label}</strong>
                    <span><input aria-label={`${club.label} 비거리`} inputMode="numeric" min="0" type="number" value={clubDistanceInputs[club.id] ?? ''} onChange={event => updateClubDistanceInput(club.id, event.target.value)} placeholder={distanceBasisChanged ? '—' : latestDistanceSet?.distances?.[club.id] ?? '—'} /></span>
                  </label> : <span className="distance-pair empty" aria-hidden="true" key={`empty-${pairIndex}`} />)}
                </div>)}
              </div>
              <div className="distance-edit-actions"><button className="secondary-button" type="button" onClick={cancelDistanceUpdate}>취소</button><button className="primary" type="submit" disabled={!hasDistanceChanges}>비거리 저장</button></div>
            </form> : <>
              <section className="current-distance-set">
                <div className="distance-set-heading distance-view-heading"><div><strong>최근 작성일 {latestDistanceSet ? <time dateTime={latestDistanceSet.recordedAt}>{compactDate(latestDistanceSet.recordedAt)}</time> : <span>없음</span>}</strong></div>{latestDistanceSet && <div className="distance-record-meta"><span>단위 <b>{latestDistanceSet.unit}</b></span><span>기준 <b>{latestDistanceSet.basis === 'carry' ? '캐리' : latestDistanceSet.basis === 'total' ? '총거리' : '미지정'}</b></span></div>}</div>
                <div className="distance-pair-table view">
                  <div className="distance-pair-header"><span>클럽</span><span>비거리</span><span>클럽</span><span>비거리</span></div>
                  {distanceClubPairs.map((pair, rowIndex) => <div className="distance-pair-row" key={rowIndex}>
                    {pair.map((club, pairIndex) => club ? <div className={`distance-pair ${recentlyChangedClubIds.includes(club.id) ? 'changed' : ''}`} key={club.id}>
                      <strong>{club.label}</strong><span>{latestDistanceSet?.distances?.[club.id] ?? '—'}</span>
                    </div> : <span className="distance-pair empty" aria-hidden="true" key={`empty-${pairIndex}`} />)}
                  </div>)}
                </div>
              </section>

              <button className="primary distance-update-button" type="button" onClick={beginDistanceUpdate}>{latestDistanceSet ? '비거리 수정하기' : '비거리 입력하기'}</button>

            </>}
          </>}
        </section>
      )}

      {screen === 'new-round' && (
        <section className="new-round">
          <div className="compact-page-header">
            <button className="back" onClick={() => setScreen(editingActiveRound ? (activeRound?.status === 'completed' ? 'round-result' : 'scorecard') : 'home')} aria-label={editingActiveRound ? '기록으로 돌아가기' : '홈으로 돌아가기'}>←</button>
            <h1>{editingActiveRound ? '라운드 정보' : '새 라운드'}</h1>
          </div>
          <form onSubmit={createRound} className="form-card">
            {!editingActiveRound && !latestDistanceSet && <div className="new-round-distance-hint">
              <div><strong>클럽별 비거리도 기록할 수 있어요</strong><span>미리 입력하면 라운드 중 클럽 선택에 참고하기 좋아요.</span></div>
              <button type="button" onClick={() => { setClubSetupReturn('new-round-distance'); setClubStage('distance'); setClubCompositionEditing(false); setClubDistanceEditing(false); setScreen('clubs') }}>입력하기</button>
            </div>}
            <div className="course-search-field">
              <label>골프장명<input ref={courseNameInputRef} required disabled={roundStructureLocked} autoComplete="off" value={round.courseName} onFocus={() => { if (!roundStructureLocked) setCourseSuggestionsOpen(true) }} onBlur={() => window.setTimeout(() => setCourseSuggestionsOpen(false), 120)} onChange={e => { setRound({...round, courseId: null, courseName: e.target.value}); setCourseSuggestionsOpen(true) }} placeholder="예: 레이크사이드" /></label>
              {!roundStructureLocked && courseSuggestionsOpen && !round.courseId && knownCourseSuggestions.length > 0 && <div className="course-suggestions" role="listbox" aria-label="홀 정보가 있는 골프장">
                {knownCourseSuggestions.map(course => <button type="button" role="option" key={course.id} onMouseDown={event => event.preventDefault()} onClick={() => { setRound(current => selectKnownCourse(course, current)); setCourseSuggestionsOpen(false); courseNameInputRef.current?.blur() }}><span><strong>{course.name}</strong><small>{course.segments.map(segment => segment.name).join(' · ')}</small></span><b>홀 정보</b></button>)}
              </div>}
            </div>
            <div className="course-pair-fields">
              <label>전반 코스{selectedKnownCourse ? <select required disabled={roundStructureLocked} value={round.frontCourseName} onChange={e => setRound({...round, frontCourseName: e.target.value})}>{knownSegmentNames.map(name => <option key={name}>{name}</option>)}</select> : <input required disabled={roundStructureLocked} list="front-course-history" value={round.frontCourseName} onChange={e => setRound({...round, frontCourseName: e.target.value})} placeholder="예: IN 또는 USA" />}</label>
              <label>후반 코스{selectedKnownCourse ? <select required disabled={roundStructureLocked} value={round.backCourseName} onChange={e => setRound({...round, backCourseName: e.target.value})}>{knownSegmentNames.map(name => <option key={name}>{name}</option>)}</select> : <input required disabled={roundStructureLocked} list="back-course-history" value={round.backCourseName} onChange={e => setRound({...round, backCourseName: e.target.value})} placeholder="예: OUT 또는 Europe" />}</label>
            </div>
            {!round.courseId && round.courseName.trim().length >= 2 && knownCourseSuggestions.length === 0 && <p className="course-info-note"><strong>홀 정보 없음</strong><span>PAR와 홀 거리는 홀별로 직접 입력합니다.</span></p>}
            {editingActiveRound && <p className={`structure-edit-note ${roundStructureLocked ? 'locked' : ''}`}>{roundStructureLocked ? '골프장과 코스는 홀 기록과 연결되어 변경할 수 없어요.' : '골프장과 코스는 세 번째 플레이 홀까지 변경할 수 있어요.'}</p>}
            <datalist id="front-course-history">{frontCourseSuggestions.map(name => <option key={name} value={name} />)}</datalist>
            <datalist id="back-course-history">{backCourseSuggestions.map(name => <option key={name} value={name} />)}</datalist>
            <div className="tee-unit-fields"><label>티그라운드<select value={round.tee} onChange={e => setRound({...round, tee: e.target.value})}>{teeOptions.map(tee => <option key={tee.value}>{tee.value}</option>)}</select></label><fieldset><legend>거리 단위</legend><div><button type="button" className={round.distanceUnit === 'M' ? 'selected' : ''} onClick={() => setRound({...round, distanceUnit: 'M'})}>M</button><button type="button" className={round.distanceUnit === 'YD' ? 'selected' : ''} onClick={() => setRound({...round, distanceUnit: 'YD'})}>YD</button></div></fieldset></div>
            <div className="field-group">
              <span className="field-label">날짜와 시간</span>
              <button type="button" className="date-time-trigger" onClick={openDateTimePicker} aria-haspopup="dialog">
                <span>{formattedPlayedAt()}</span><span aria-hidden="true">▾</span>
              </button>
            </div>
            <details className="additional-fields">
              <summary>추가 정보 <span>동반자 메모</span></summary>
              <div className="additional-fields-content">
                <label>동반자 메모 <span className="optional">선택</span><textarea value={round.companionMemo} onChange={e => setRound({...round, companionMemo: e.target.value})} placeholder="함께 플레이한 사람을 기록해보세요" rows="2" /></label>
              </div>
            </details>
            <button className="primary" type="submit">{editingActiveRound ? (roundStructureLocked ? '날짜·티 정보 저장' : '라운드 정보 저장') : '18홀 시작하기'}</button>
          </form>
        </section>
      )}

      {screen === 'round-result' && activeRound && (
        <section className="round-result">
          <div className="compact-page-header">
            <button className="back" onClick={() => { setActiveRound(null); setScreen('home') }} aria-label="홈으로 돌아가기">←</button>
            <h1>라운드 결과</h1>
          </div>
          <div className="round-result-heading">
            <p className="eyebrow">18홀 기록 완료</p>
            <h2>{activeRound.courseName}</h2>
            <p>{compactCoursePair(activeRound.frontCourseName, activeRound.backCourseName)} · <span className="round-result-tee"><i className={`tee-dot ${teeColorClass(activeRound.tee)}`} aria-hidden="true" />{activeRound.tee}티</span> · {compactRoundDate(activeRound.playedAt)}</p>
          </div>
          {(roundStats.missingParHoles > 0 || distanceCoverage.unresolvedMissingHoles > 0) && <div className="result-data-warnings" role="status">
            {roundStats.missingParHoles > 0 && <p><b aria-hidden="true">⚠️</b><span>PAR 정보가 없는 {roundStats.missingParHoles}개 홀은 파 대비와 스코어 분포에서 제외됐어요.</span></p>}
            {distanceCoverage.unresolvedMissingHoles > 0 && <p><b aria-hidden="true">⚠️</b><span>거리 정보가 없는 {distanceCoverage.unresolvedMissingHoles}개 홀은 거리 기반 분석에서 제외됐어요.</span></p>}
          </div>}
          <div className="result-score-card" aria-label="라운드 최종 점수">
            <span className="result-total-score"><small>최종 스코어</small><strong>{formatToPar(roundStats.toPar)}{roundStats.missingParHoles > 0 && <ParWarningIcon />} <i>/</i> {roundStats.totalScore}타</strong></span>
            <span><small>전반 · {activeRound.frontCourseName}</small><strong>{formatToPar(roundStats.frontToPar)} <i>/</i> {roundStats.frontScore}타</strong></span>
            <span><small>후반 · {activeRound.backCourseName}</small><strong>{formatToPar(roundStats.backToPar)} <i>/</i> {roundStats.backScore}타</strong></span>
          </div>
          <div className="result-outcomes" aria-label="홀별 스코어 분포">
            {roundStats.scoreOutcomes.map(outcome => <span key={outcome.key}><small>{outcome.label}</small><strong>{outcome.count}</strong></span>)}
            {roundStats.holeInOneCount > 0 && <span className="result-achievement"><small>홀인원</small><strong>{roundStats.holeInOneCount}</strong></span>}
          </div>
          <section className="result-stats" aria-labelledby="result-stats-title">
            <div className="result-section-heading"><h3 id="result-stats-title">플레이 요약</h3></div>
            <div className="result-stat-grid">
              <div><small>페어웨이 안착</small><strong>{formatPercent(roundStats.firHits, roundStats.firAttempts)}</strong><span>{roundStats.firHits}/{roundStats.firAttempts}홀 · 파3 제외</span></div>
              <div><small>그린 적중</small><strong>{formatPercent(roundStats.girHits, roundStats.girAttempts)}</strong><span>{roundStats.girHits}/{roundStats.girAttempts}홀</span></div>
              <div><small>벌타</small><strong>{roundStats.penaltyStrokes}타</strong><span>OB {roundStats.obCount}개 · 패널티 {roundStats.penaltyCount}개</span></div>
              <div className="putting-stat"><small>퍼팅</small><strong>{roundStats.puttAttempts ? `${roundStats.totalPutts}회` : '—'}</strong><span className="putting-average">평균 <b>{roundStats.averagePutts?.toFixed(1) ?? '—'}</b></span><span className="putting-distribution">1 put <b>{roundStats.puttAttempts ? roundStats.onePuttCount : '—'}</b> · 2 put <b>{roundStats.puttAttempts ? roundStats.twoPuttCount : '—'}</b> · 3 put+ <b>{roundStats.puttAttempts ? roundStats.threePlusPuttCount : '—'}</b></span></div>
            </div>
          </section>
          <p className="result-policy-note">현재 기록된 홀만 통계에 포함하고, 값이 없는 항목은 분모에서 제외합니다.</p>
          <div className="result-actions">
            <button className="primary" type="button" onClick={() => setScreen('scorecard')}>스코어카드 보기</button>
            <button className="secondary-button" type="button" onClick={openActiveRoundInfo}>날짜·티 정보 수정</button>
          </div>
          <button className="delete-completed-round" type="button" onClick={() => requestRoundDeletion(activeRound)}>완료한 기록 삭제</button>
        </section>
      )}

      {screen === 'scorecard' && (
        <section className="scorecard">
          <div className="compact-page-header scorecard-header">
            <button className="back" onClick={activeRound?.status === 'completed' ? () => setScreen('round-result') : () => { setActiveRound(null); setHoleDraft(null); setEditingActiveRound(false); setScreen('home') }} aria-label={activeRound?.status === 'completed' ? '라운드 결과로 돌아가기' : '홈으로 돌아가기'}>←</button>
            <div className="compact-page-title">
              <h1>스코어카드</h1>
            </div>
          </div>
          <button className="round-meta" type="button" onClick={openActiveRoundInfo} aria-label="라운드 정보 수정">
            <span className="round-course-name">{activeRound?.courseName}</span>
            <span aria-hidden="true">·</span>
            <span className="round-tee"><i className={`tee-dot ${teeColorClass(activeRound?.tee)}`} aria-hidden="true" />{activeRound?.tee}티</span>
            <span aria-hidden="true">·</span>
            <time dateTime={activeRound?.playedAt}>{compactRoundDate(activeRound?.playedAt)}</time>
            <span className="round-meta-chevron" aria-hidden="true">›</span>
          </button>
          <div className="nine-section">
            <div className="nine-heading"><strong>전반 · {activeRound?.frontCourseName || activeRound?.courseNameDetail}</strong><span>{nineTotal(1, 9)}</span></div>
            <div className="hole-grid">{activeRound?.holes.filter(hole => hole.holeNumber <= 9).map(hole => (
              <button className={`hole ${inProgressHoleNumbers.has(hole.holeNumber) ? 'in-progress' : ''} ${latestDraftHoleNumber === hole.holeNumber ? 'is-latest-draft' : ''}`} key={hole.holeNumber} onClick={() => openHole(hole)} aria-label={holeAriaLabel(hole)}>
                <span className="hole-meta"><span className="hole-number-line"><span className="hole-number" aria-hidden="true">{holeDisplayNumber(hole)}</span>{inProgressHoleNumbers.has(hole.holeNumber) && <span className="hole-draft-badge"><i aria-hidden="true" />입력중</span>}</span><span>PAR {hole.par ?? '—'}</span></span>
                <strong className={`hole-score ${!Number.isFinite(hole.score) ? 'empty' : ''} ${Number.isFinite(hole.score) && !Number.isFinite(hole.par) ? 'unknown-par' : ''}`} aria-hidden="true">{holeScoreDisplay(hole)}</strong>
              </button>
            ))}</div>
          </div>
          <div className="nine-section">
            <div className="nine-heading"><strong>후반 · {activeRound?.backCourseName || activeRound?.courseNameDetail}</strong><span>{nineTotal(10, 18)}</span></div>
            <div className="hole-grid">{activeRound?.holes.filter(hole => hole.holeNumber > 9).map(hole => (
              <button className={`hole ${inProgressHoleNumbers.has(hole.holeNumber) ? 'in-progress' : ''} ${latestDraftHoleNumber === hole.holeNumber ? 'is-latest-draft' : ''}`} key={hole.holeNumber} onClick={() => openHole(hole)} aria-label={holeAriaLabel(hole)}>
                <span className="hole-meta"><span className="hole-number-line"><span className="hole-number" aria-hidden="true">{holeDisplayNumber(hole)}</span>{inProgressHoleNumbers.has(hole.holeNumber) && <span className="hole-draft-badge"><i aria-hidden="true" />입력중</span>}</span><span>PAR {hole.par ?? '—'}</span></span>
                <strong className={`hole-score ${!Number.isFinite(hole.score) ? 'empty' : ''} ${Number.isFinite(hole.score) && !Number.isFinite(hole.par) ? 'unknown-par' : ''}`} aria-hidden="true">{holeScoreDisplay(hole)}</strong>
              </button>
            ))}</div>
          </div>
          <div className="score-summary" aria-label="현재 스코어 요약">
            <span className="score-summary-progress">입력 <strong>{enteredHoles.length}/18홀</strong></span>
            <span className="score-summary-result">
              <span>{enteredHoles.length === 18 ? '합계' : '현재 합계'} <strong>{enteredHoles.length ? `${enteredTotal}타` : '—'}</strong></span>
              <span>파 대비{roundStats.missingParHoles > 0 && <ParWarningIcon />} <strong className={holesWithPar.length ? 'cherrie-num' : ''}>{formatToPar(scoreToPar)}</strong></span>
            </span>
          </div>
          {activeRound?.status !== 'completed' && <div className="round-completion-action">
            <button className="primary" type="button" disabled={!completionState.canComplete} onClick={() => setRoundCompletionOpen(true)}>라운드 완료</button>
          </div>}
          {activeRound?.status === 'completed' && <button className="delete-completed-round" type="button" onClick={() => requestRoundDeletion(activeRound)}>완료한 기록 삭제</button>}
        </section>
      )}

      {screen === 'hole-detail' && holeDraft && (
        <section className="hole-detail">
          <div className="compact-page-header">
            <button className="back" onClick={leaveHoleDetail} aria-label={holeMode === 'draft' ? '입력을 임시 저장하고 스코어카드로 돌아가기' : holeMode === 'edit' ? '수정을 취소하고 스코어카드로 돌아가기' : '스코어카드로 돌아가기'}>←</button>
            <div className="compact-page-title"><h1>{holeDisplayNumber(holeDraft)}번 홀</h1><span>{holeDraft.holeNumber <= 9 ? activeRound?.frontCourseName : activeRound?.backCourseName}</span></div>
            <div className="live-score"><small>현재</small><strong>{calculateHoleTotals(holeDraft.shots, holeDraft.putts).usedShots.length ? calculateHoleTotals(holeDraft.shots, holeDraft.putts).score : '—'}</strong></div>
          </div>
          <div className={`par-strip ${holeMode !== 'view' && !Number.isFinite(holeDraft.par) ? 'is-current' : ''}`} role="group" aria-label="홀 파 선택"><span className="par-label">PAR</span><div className="detail-choices par-choices">{[3, 4, 5, 6].map(par => <button type="button" key={par} disabled={holeMode === 'view'} className={holeDraft.par === par ? 'selected' : ''} onClick={() => setHoleDraft(current => ({ ...current, par, parSource: 'user', fir: par === 3 ? null : current.fir }))}>{par}</button>)}</div></div>
          {holeMode !== 'view' && !Number.isFinite(holeDraft.par) && <p className="par-task-hint"><span aria-hidden="true" />지금 입력 · PAR를 선택하세요</p>}
          {showHoleDistanceWarning && <p className="hole-distance-warning" role="status"><b aria-hidden="true">⚠️</b><span>{distanceCoverage.sourceMissingHoles === distanceCoverage.totalHoles
            ? `${activeRound.tee} 티 홀 거리가 자동 제공되지 않는 골프장입니다. 홀별로 직접 입력해 주세요.`
            : `${activeRound.tee} 티 홀거리 정보가 제공되지 않는 홀입니다.`}</span></p>}
          {holeMode === 'view' ? (
            <div className="hole-detail-card completed-hole-summary">
              {holeDraft.shots.filter(isRecordedShot).map((shot, index) => (
                <div className="completed-summary-row" key={index}><strong>{shotName(index, shot)}</strong><span>{shotSummary(index, shot)}</span></div>
              ))}
              <div className="completed-summary-row putting-summary"><strong>퍼팅</strong><span>{holeDraft.puttingStartLie === 'fringe' ? '엣지' : '그린'} 시작 · {holeDraft.puttingDistance ? `${holeDraft.puttingDistance}m · ` : ''}{holeDraft.puttingSteps ? `${holeDraft.puttingSteps}걸음 · ` : ''}{holeDraft.putts}회</span></div>
            </div>
          ) : <div className="hole-detail-card">
            <div className="shot-list">{holeDraft.shots.map((shot, index) => {
              const entryComplete = shotEntryComplete(index, shot)
              const isUnused = Number.isFinite(holeDraft.putts) && !isRecordedShot(shot)
              const hasPartialInput = isRecordedShot(shot)
              const progressClass = currentShotIndex === index ? 'is-current' : entryComplete ? 'is-complete' : isUnused ? 'is-unused' : hasPartialInput ? 'is-started' : 'is-future'
              return <article className={`shot-row ${activeShotIndex === 'all' || activeShotIndex === index ? 'is-open' : 'is-summary'} ${progressClass}`} key={index}>
                {activeShotIndex !== 'all' && activeShotIndex !== index ? (
                  <button className="shot-summary-row" type="button" onClick={() => setActiveShotIndex(index)}>
                    <strong>{shotName(index, shot)}</strong>
                    <span>{shotSummary(index, shot)}</span>
                    <span aria-hidden="true">›</span>
                  </button>
                ) : <>
                <div className={`shot-heading ${index >= 4 ? 'has-remove' : ''}`}>
                  <strong>{shotName(index, shot)}</strong>
                  <label className={`distance-field ${index === 0 && showHoleDistanceWarning ? 'needs-manual-distance' : ''}`}>{index === 0 ? '홀거리' : '남은거리'}<input inputMode="numeric" value={index === 0 ? (holeDraft.distance ?? '') : shot.remainingDistance} onChange={e => index === 0 ? updateTeeDistance(e.target.value) : updateShot(index, { remainingDistance: e.target.value })} placeholder={index === 0 && !activeRound?.courseId ? '—' : '0'} />{activeRound?.distanceUnit === 'YD' ? 'yd' : 'm'}</label>
                  <label className="club-field">클럽<select value={shotClubValue(shot)} onChange={e => updateShotClub(index, e.target.value)}><option value="">선택</option>{shotClubOptions(shot).map(club => <option key={club.value} value={club.value}>{club.label}</option>)}</select></label>
                  {index >= 4 && <button className="remove-shot" type="button" onClick={() => removeAddedShot(index)} aria-label={`${shotName(index, shot)} 삭제`}>×</button>}
                </div>
                {currentShotIndex === index && <p className="shot-task-hint"><span aria-hidden="true" />지금 입력 · {shotTaskLabel(index)}</p>}
                <div className="trouble-field">
                  <button className="trouble-trigger" type="button" aria-expanded={openTroubleRows.includes(index)} onClick={() => setOpenTroubleRows(current => current.includes(index) ? current.filter(row => row !== index) : [...current, index])}>
                    <strong>트러블</strong><span>{troubleSummary(shot) || '특이사항이 있을 때만'}</span><b aria-hidden="true">⌄</b>
                  </button>
                  {openTroubleRows.includes(index) && <>
                  <div className="trouble-checks">
                    <button type="button" aria-pressed={shot.troubleDirection === 'left'} className={shot.troubleDirection === 'left' ? 'selected' : ''} onClick={() => updateShot(index, { troubleDirection: shot.troubleDirection === 'left' ? null : 'left' })}>좌</button>
                    <button type="button" aria-pressed={shot.troubleDirection === 'right'} className={shot.troubleDirection === 'right' ? 'selected' : ''} onClick={() => updateShot(index, { troubleDirection: shot.troubleDirection === 'right' ? null : 'right' })}>우</button>
                    <span className="trouble-divider" aria-hidden="true" />
                    {[['rough','러프'],['bunker','벙커'],['penalty','페널티'],['ob','OB']].map(([value,label]) => <button type="button" aria-pressed={shot.troubleType === value} key={value} className={shot.troubleType === value ? 'selected' : ''} onClick={() => selectTrouble(index, value)}>{label}</button>)}
                  </div>
                  {shot.troubleType === 'ob' && <div className="ob-relief" role="group" aria-label="OB 처리 방법">
                    <span>OB 처리</span>
                    <button type="button" className={shot.obRelief === 'replay' ? 'selected' : ''} aria-pressed={shot.obRelief === 'replay'} onClick={() => selectObRelief(index, 'replay')}>재샷 <b>+1</b></button>
                    <button type="button" className={shot.obRelief === 'forward' ? 'selected' : ''} aria-pressed={shot.obRelief === 'forward'} onClick={() => selectObRelief(index, 'forward')}>전진 구제 <b>+2</b></button>
                  </div>}
                  {(shot.troubleDirection || shot.troubleType) && <button className="clear-trouble" type="button" onClick={() => clearTrouble(index)}>트러블 해제</button>}
                  </>}
                </div>
                </>}
              </article>
            })}</div>
            <button className="add-shot" type="button" onClick={() => { setHoleDraft(current => ({ ...current, shots: [...current.shots, emptyShot(current.shots.length + 1)] })); if (activeShotIndex !== 'all') setActiveShotIndex(holeDraft.shots.length) }}>+ 샷 추가</button>
            <div className={`detail-field putting-field ${puttingHasStarted ? 'is-current' : Number.isFinite(holeDraft.putts) ? 'is-complete' : 'is-future'}`} role="group" aria-label="퍼팅 기록">
              <div className="putting-heading"><strong>퍼팅</strong><label className="putting-distance-field">남은거리<input inputMode="decimal" value={holeDraft.puttingDistance} onChange={e => setHoleDraft(current => ({ ...current, puttingDistance: e.target.value }))} placeholder="0" />m</label><label className="putting-step-field">발걸음<input inputMode="numeric" value={holeDraft.puttingSteps} onChange={e => setHoleDraft(current => ({ ...current, puttingSteps: e.target.value }))} placeholder="0" /></label></div>
              {puttingHasStarted && <p className="shot-task-hint"><span aria-hidden="true" />지금 입력 · 퍼팅수를 선택하세요</p>}
              <div className="putting-controls">
                <div className="putting-start"><span>시작</span><div role="radiogroup" aria-label="퍼팅 시작 위치"><button type="button" role="radio" aria-checked={holeDraft.puttingStartLie !== 'fringe'} className={holeDraft.puttingStartLie !== 'fringe' ? 'selected' : ''} onClick={() => setHoleDraft(current => ({ ...current, puttingStartLie: 'green' }))}>그린</button><button type="button" role="radio" aria-checked={holeDraft.puttingStartLie === 'fringe'} className={holeDraft.puttingStartLie === 'fringe' ? 'selected' : ''} onClick={() => setHoleDraft(current => ({ ...current, puttingStartLie: 'fringe' }))}>엣지</button></div></div>
                <div className="putting-count"><span>퍼팅수</span><div className="putting-count-wrap"><div className="putting-choices">{[0, 1, 2, 3, 4].map(putts => <button type="button" key={putts} className={holeDraft.putts === putts ? 'selected' : ''} onClick={() => selectPutts(putts)}>{putts}</button>)}<button type="button" className={holeDraft.putts >= 5 || puttMoreOpen ? 'selected custom-value' : ''} aria-expanded={puttMoreOpen} aria-haspopup="dialog" onClick={openCustomPutts}>{holeDraft.putts >= 5 ? <><span className="cherrie-num">{holeDraft.putts}</span><small>⌄</small></> : '+'}</button></div>{puttMoreOpen && <form className="putting-more" role="dialog" aria-label="퍼팅수 직접 입력" onSubmit={applyCustomPutts}><label>5 이상<input autoFocus type="number" min="5" step="1" inputMode="numeric" value={customPutts} onChange={event => setCustomPutts(event.target.value)} /></label><button type="submit" disabled={!Number.isInteger(Number(customPutts)) || Number(customPutts) < 5}>완료</button></form>}</div></div>
              </div>
            </div>
          </div>}
          {holeMode !== 'view' && holeCompletion && <div className="hole-completion-check" aria-live="polite">
            <p><strong>현재 기록</strong><span>샷 {holeCompletion.swingCount} · 퍼팅 {Number.isFinite(holeDraft.putts) ? holeDraft.putts : '—'} · 벌타 {holeCompletion.penaltyStrokes} = {Number.isFinite(holeDraft.putts) && holeCompletion.swingCount ? `${holeCompletion.score}타` : '—'}</span></p>
            {!holeCompletion.canFinalize && <small className="blocking">{holeCompletion.blockingMessages[0]}</small>}
            {holeCompletion.canFinalize && holeCompletion.advisoryMessages.map(message => <small key={message}>{message}</small>)}
          </div>}
          {holeMode === 'view' ? (
            <button className="primary save-hole" type="button" onClick={beginHoleEdit}>홀 기록 수정</button>
          ) : holeMode === 'edit' ? (
            <button className="primary save-hole" type="button" onClick={saveHole} disabled={!holeHasChanges || !holeCanFinalize}>변경사항 저장</button>
          ) : (
            <div className="hole-save-actions">
              <button className="save-hole secondary-save" type="button" onClick={saveHoleDraft}>임시 저장</button>
              <button className="primary save-hole" type="button" onClick={saveHole} disabled={!holeCanFinalize}>홀 기록 완료</button>
            </div>
          )}
        </section>
      )}

      {accountOpen && (
        <div className="account-layer">
          <button className="account-backdrop" onClick={() => setAccountOpen(false)} aria-label="계정 메뉴 닫기" />
          <section className="account-sheet" role="dialog" aria-modal="true" aria-labelledby="account-title">
            <div className="sheet-handle" />
            <div className="account-heading">
              <h2 id="account-title">내 계정</h2>
              <button className="close-button" onClick={() => setAccountOpen(false)} aria-label="닫기">×</button>
            </div>
            <div className="account-profile">
              <div className="account-avatar">
                {avatarUrl
                  ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" />
                  : displayName?.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <strong>{displayName}</strong>
                <span>{session.user.email}</span>
              </div>
            </div>
            <button className="account-menu-button" type="button" onClick={openClubBag}>
              <span><b aria-hidden="true">♧</b><strong>내 골프백</strong></span>
              <i aria-hidden="true">→</i>
            </button>
            <button className="account-menu-button" type="button" onClick={openNews} aria-label={unseenNews ? '새소식, 새 글 있음' : '새소식'}>
              <span><b className="news-menu-icon" aria-hidden="true"><MegaphoneIcon /></b><strong className="news-menu-label">새소식{unseenNews && <i className="news-unseen-dot" aria-hidden="true" />}</strong></span>
              <i aria-hidden="true">→</i>
            </button>
            <button className="account-menu-button" type="button" onClick={openFeedback}>
              <span><b className="feedback-menu-icon" aria-hidden="true"><FeedbackIcon /></b><strong>의견 보내기</strong></span>
              <i aria-hidden="true">→</i>
            </button>
            <label className="analytics-consent-control">
              <span>
                <strong>서비스 개선 분석 허용</strong>
                <small>{analyticsConsent === 'granted'
                  ? '이용 흐름만 분석하며, 계정·골프 기록은 보내지 않아요.'
                  : '현재 분석을 보내지 않아요. 허용해도 서비스 이용에는 영향이 없어요.'}</small>
              </span>
              <input type="checkbox" checked={analyticsConsent === 'granted'} onChange={event => updateAnalyticsConsent(event.target.checked)} />
            </label>
            {isDiagnosticSmokeMode && <button className="secondary-button" type="button" onClick={runDiagnosticSmokeTest} disabled={diagnosticSmokeStatus === 'sending'}>
              {diagnosticSmokeStatus === 'sending' ? '진단 전송 중…' : diagnosticSmokeStatus === 'sent' ? '진단 전송 완료' : diagnosticSmokeStatus === 'queued' ? '진단 재전송 대기' : diagnosticSmokeStatus === 'error' ? '진단 생성 실패' : '운영 진단 E2E 실행'}
            </button>}
            <button className="logout-button" onClick={signOut}>로그아웃</button>
            {!isPreviewMode && <button className="delete-account-link" type="button" onClick={openAccountDeletion}>계정 삭제</button>}
          </section>
        </div>
      )}

      {accountDeletionOpen && (
        <div className="account-layer">
          <button className="account-backdrop" onClick={() => accountDeletionStatus !== 'deleting' && setAccountDeletionOpen(false)} aria-label="계정 삭제 취소" />
          <section className="account-sheet delete-account-sheet" role="alertdialog" aria-modal="true" aria-labelledby="delete-account-title" aria-describedby="delete-account-description">
            <div className="sheet-handle" />
            <div className="account-heading">
              <h2 id="delete-account-title">계정을 삭제할까요?</h2>
              <button className="close-button" type="button" onClick={() => setAccountDeletionOpen(false)} aria-label="닫기" disabled={accountDeletionStatus === 'deleting'}>×</button>
            </div>
            <p id="delete-account-description">라운드, 홀·샷 기록, 클럽 구성과 비거리 이력을 포함한 모든 계정 데이터가 영구적으로 삭제됩니다. 삭제한 데이터는 복구할 수 없습니다.</p>
            {accountDeletionError && <p className="error-message" role="alert">{accountDeletionError}</p>}
            <div className="sheet-actions">
              <button className="secondary-button" type="button" onClick={() => setAccountDeletionOpen(false)} disabled={accountDeletionStatus === 'deleting'}>취소</button>
              <button className="danger-button" type="button" onClick={deleteAccount} disabled={accountDeletionStatus === 'deleting'}>{accountDeletionStatus === 'deleting' ? '삭제 중…' : '계정과 기록 모두 삭제'}</button>
            </div>
          </section>
        </div>
      )}

      {clubSetupPromptOpen && (
        <div className="account-layer">
          <button className="account-backdrop" onClick={() => setClubSetupPromptOpen(false)} aria-label="클럽 등록 안내 닫기" />
          <section className="account-sheet club-setup-sheet" role="dialog" aria-modal="true" aria-labelledby="club-setup-title" aria-describedby="club-setup-description">
            <div className="sheet-handle" />
            <div className="account-heading"><h2 id="club-setup-title"><span aria-hidden="true">⚠️</span> 클럽 정보가 부족해요</h2><button className="close-button" type="button" onClick={() => setClubSetupPromptOpen(false)} aria-label="닫기">×</button></div>
            <p id="club-setup-description">라운드에서 사용한 클럽을 기록하려면 먼저 골프백을 확인해 주세요.</p>
            <div className="sheet-actions"><button className="secondary-button" type="button" onClick={() => setClubSetupPromptOpen(false)}>돌아가기</button><button className="primary" type="button" onClick={() => { setClubSetupPromptOpen(false); setClubSetupReturn('new-round'); setClubStage('composition'); setClubCompositionEditing(true); setScreen('clubs') }}>클럽 등록하기</button></div>
          </section>
        </div>
      )}

      {dateTimeOpen && (
        <div className="account-layer">
          <button className="account-backdrop" onClick={() => setDateTimeOpen(false)} aria-label="날짜와 시간 선택 닫기" />
          <section className="account-sheet date-time-sheet" role="dialog" aria-modal="true" aria-labelledby="date-time-title">
            <div className="sheet-handle" />
            <div className="account-heading">
              <h2 id="date-time-title">날짜와 시간</h2>
              <button className="close-button" onClick={() => setDateTimeOpen(false)} aria-label="닫기">×</button>
            </div>
            <div className="date-time-fields">
              <label>날짜<span className="date-time-input"><input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)} /><span className="date-time-icon"><CalendarIcon /></span></span></label>
              <label>시간<span className="date-time-input"><input type="time" value={draftTime} onChange={e => setDraftTime(e.target.value)} /><span className="date-time-icon"><ClockIcon /></span></span></label>
            </div>
            <div className="sheet-actions">
              <button type="button" className="secondary-button" onClick={() => setDateTimeOpen(false)}>취소</button>
              <button type="button" className="primary" onClick={applyDateTime} disabled={!draftDate || !draftTime}>완료</button>
            </div>
          </section>
        </div>
      )}

      {pendingStructureChange && (
        <div className="account-layer">
          <button className="account-backdrop" onClick={() => setPendingStructureChange(null)} aria-label="코스 변경 취소" />
          <section className="account-sheet structure-change-sheet" role="dialog" aria-modal="true" aria-labelledby="structure-change-title" aria-describedby="structure-change-description">
            <div className="sheet-handle" />
            <div className="account-heading"><h2 id="structure-change-title">기존 홀 기록을 어떻게 할까요?</h2><button className="close-button" onClick={() => setPendingStructureChange(null)} aria-label="닫기">×</button></div>
            <p id="structure-change-description">현재 {pendingStructureChange.inputCount}개 홀에 입력한 내용이 있습니다. 새 골프장·코스 정보에 기존 기록을 연결할지 선택해주세요.</p>
            <div className="structure-change-options">
              <button type="button" className="primary" onClick={() => applyStructureChange(false)}><strong>기록 유지하고 코스만 변경</strong><span>샷·퍼팅은 유지하고 홀번호·PAR·거리를 다시 연결합니다.</span></button>
              <button type="button" className="danger-button" onClick={() => applyStructureChange(true)}><strong>홀 기록 지우고 다시 시작</strong><span>라운드 정보는 유지하고 첫 홀부터 다시 기록합니다.</span></button>
              <button type="button" className="secondary-button" onClick={() => setPendingStructureChange(null)}>취소</button>
            </div>
          </section>
        </div>
      )}

      {pendingRoundStart && (
        <div className="account-layer">
          <button className="account-backdrop" onClick={() => setPendingRoundStart(null)} aria-label="홀 정보 확인 닫기" />
          <section className="account-sheet round-start-sheet" role="alertdialog" aria-modal="true" aria-labelledby="round-start-title" aria-describedby="round-start-description">
            <div className="sheet-handle" />
            <div className="account-heading"><h2 id="round-start-title">선택한 홀 정보를 확인해주세요</h2><button className="close-button" onClick={() => setPendingRoundStart(null)} aria-label="닫기">×</button></div>
            <p className="round-start-summary"><strong>{pendingRoundStart.courseName}</strong><span>{pendingRoundStart.frontCourseName} → {pendingRoundStart.backCourseName} · {pendingRoundStart.tee}티 · {pendingRoundStart.distanceUnit}</span></p>
            <p id="round-start-description">선택한 코스의 PAR와 티별 거리로 18홀을 생성합니다. 골프장과 코스는 세 번째 플레이 홀까지 변경할 수 있고, 그 이후에는 새 라운드를 만들어야 합니다.</p>
            <div className="sheet-actions"><button type="button" className="secondary-button" onClick={() => setPendingRoundStart(null)}>다시 확인</button><button type="button" className="primary" onClick={() => { const confirmedRound = pendingRoundStart; setPendingRoundStart(null); commitRoundRecord(confirmedRound, false) }}>이 정보로 시작</button></div>
          </section>
        </div>
      )}

      {roundCompletionOpen && activeRound && (
        <div className="account-layer">
          <button className="account-backdrop" onClick={() => setRoundCompletionOpen(false)} aria-label="라운드 완료 확인 닫기" />
          <section className="account-sheet round-completion-sheet" role="alertdialog" aria-modal="true" aria-labelledby="round-completion-title" aria-describedby="round-completion-description">
            <div className="sheet-handle" />
            <div className="account-heading"><h2 id="round-completion-title">이 라운드를 완료할까요?</h2><button className="close-button" onClick={() => setRoundCompletionOpen(false)} aria-label="닫기">×</button></div>
            <div className="round-completion-summary" aria-label="완료 전 최종 점수"><span><small>입력</small><strong>18/18홀</strong></span><span><small>최종 스코어</small><strong>{formatToPar(roundStats.toPar)} / {roundStats.totalScore}타</strong></span></div>
            <p id="round-completion-description">완료하면 결과와 플레이 통계를 확인할 수 있습니다. 완료 후에도 홀 기록을 수정할 수 있고, 수정한 결과는 즉시 다시 계산됩니다.</p>
            <div className="sheet-actions"><button type="button" className="secondary-button" onClick={() => setRoundCompletionOpen(false)}>스코어카드 확인</button><button type="button" className="primary" onClick={completeRound}>라운드 완료</button></div>
          </section>
        </div>
      )}

      {roundPendingDeletion && (
        <div className="account-layer">
          <button className="account-backdrop" onClick={() => setRoundPendingDeletion(null)} aria-label="기록 삭제 취소" />
          <section className="account-sheet delete-round-sheet" role="alertdialog" aria-modal="true" aria-labelledby="delete-round-title" aria-describedby="delete-round-description">
            <div className="sheet-handle" />
            <div className="account-heading"><h2 id="delete-round-title">{roundPendingDeletion.status === 'completed' ? '완료한 기록을 삭제할까요?' : '작성 중인 기록을 삭제할까요?'}</h2><button className="close-button" onClick={() => setRoundPendingDeletion(null)} aria-label="닫기">×</button></div>
            <p id="delete-round-description"><strong>{roundPendingDeletion.courseName}</strong> 기록과 홀별 임시 입력이 함께 삭제됩니다.{roundPendingDeletion.status === 'completed' ? ' 누적 통계에서도 제외되며 현재 버전에서는 복구할 수 없습니다.' : ' 현재 버전에서는 복구할 수 없습니다.'}</p>
            <div className="sheet-actions"><button type="button" className="secondary-button" onClick={() => setRoundPendingDeletion(null)}>취소</button><button type="button" className="danger-button" onClick={deleteRound}>{roundPendingDeletion.status === 'completed' ? '완료 기록 삭제' : '삭제'}</button></div>
          </section>
        </div>
      )}
    </main>
  )
}
