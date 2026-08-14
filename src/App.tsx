import { useCallback, useEffect, useState } from 'react'
import './App.css'

import { ToastHost, ConfirmHost } from './components/ui'
import { Header } from './components/Header'
import { TabBar, TABS, type TabId } from './components/TabBar'
import { Gate } from './components/Gate'
import { Settings } from './components/Settings'
import { Logo } from './components/Logo'

import { PositionsTab } from './tabs/Positions'
import { CuisinesTab } from './tabs/Cuisines'
import { TitlesTab } from './tabs/Titles'
import { McuTab } from './tabs/Mcu'
import { VenuesTab } from './tabs/Venues'
import { TodoTab } from './tabs/Todo'

import { useSession, profileOf } from './lib/session'
import { syncClock } from './lib/clock'
import { flushOutbox } from './lib/collection'

const LS_TAB = 'lj.tab'

function initialTab(): TabId {
  const saved = localStorage.getItem(LS_TAB) as TabId | null
  return TABS.some((t) => t.id === saved) ? (saved as TabId) : 'positions'
}

export function App() {
  const session = useSession()
  const [tab, setTab] = useState<TabId>(initialTab)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const changeTab = useCallback((next: TabId) => {
    setTab(next)
    localStorage.setItem(LS_TAB, next)
    // Each room starts at the top.
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [])

  useEffect(() => {
    if (session.state.kind !== 'ready') return
    void syncClock()
    void flushOutbox()
  }, [session.state.kind])

  // Sheets and the FAB portal into <body>, outside the .app scope — the body
  // needs the tab attribute too or they lose the room's accent colour.
  useEffect(() => {
    document.body.dataset.tab = tab
  }, [tab])

  if (session.state.kind === 'booting') {
    return (
      <div className="splash">
        <Logo size={62} animate />
      </div>
    )
  }

  if (session.state.kind === 'needs-profile' || session.state.kind === 'needs-passcode') {
    return (
      <ToastHost>
        <Gate session={session} />
      </ToastHost>
    )
  }

  const who = session.state.who
  const me = profileOf(who)!

  return (
    <ToastHost>
      <ConfirmHost>
        <div className="app" data-tab={tab}>
          <Header
            tab={tab}
            me={me}
            localOnly={session.state.kind === 'local'}
            onOpenSettings={() => setSettingsOpen(true)}
          />

          <main className="main" key={tab}>
            {tab === 'positions' && <PositionsTab me={me} />}
            {tab === 'cuisines' && <CuisinesTab me={me} />}
            {tab === 'movies' && <TitlesTab kind="movie" me={me} />}
            {tab === 'shows' && <TitlesTab kind="tv" me={me} />}
            {tab === 'mcu' && <McuTab me={me} />}
            {tab === 'nachos' && <VenuesTab kind="nachos" me={me} />}
            {tab === 'salads' && <VenuesTab kind="salad" me={me} />}
            {tab === 'todo' && <TodoTab me={me} />}
          </main>

          <TabBar tab={tab} onChange={changeTab} />

          <Settings
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            session={session}
            me={me}
          />
        </div>
      </ConfirmHost>
    </ToastHost>
  )
}
