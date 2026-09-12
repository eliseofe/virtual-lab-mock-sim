import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0'

const SUPABASE_URL = 'https://izdmmudfrmqhvlgepwes.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_MKaLNxnqvYbJUyik9zN7WA_r4ie2P5d'
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)

const $ = (id) => document.getElementById(id)
const els = {
  message: $('message'), authPanel: $('auth-panel'), consentPanel: $('consent-panel'), workspace: $('workspace'),
  identity: $('identity'), email: $('email'), password: $('password'), signIn: $('sign-in'), signUp: $('sign-up'), signOut: $('sign-out'),
  oauthClient: $('oauth-client'), oauthScopes: $('oauth-scopes'), oauthApprove: $('oauth-approve'), oauthDeny: $('oauth-deny'),
  workspaceUser: $('workspace-user'), syncState: $('sync-state'), refresh: $('refresh'), collections: $('collections'), experiments: $('experiments'),
  newCollection: $('new-collection'), newExperiment: $('new-experiment'), emptyEditor: $('empty-editor'), form: $('experiment-form'),
  title: $('title'), description: $('description'), collectionSelect: $('collection-select'), revision: $('revision'), lifecycle: $('lifecycle'),
  configSource: $('config-source'), initializerSource: $('initializer-source'), controllerSource: $('controller-source'),
  archive: $('archive'), restore: $('restore'), delete: $('delete'),
}

let user = null
let profile = null
let collections = []
let experiments = []
let selected = null
let selectedFilter = 'all'
let dirty = false
let pollTimer = null
const authorizationId = new URLSearchParams(location.search).get('authorization_id')

function showMessage(text, kind = 'info') {
  els.message.textContent = text
  els.message.className = `message${kind === 'error' ? ' error' : ''}`
  els.message.hidden = !text
}
function setSync(text) { els.syncState.textContent = text }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[ch]))
}

async function registryProfile() {
  const { data, error } = await supabase.from('profiles').select('id, display_name').single()
  if (error) throw error
  return data
}
async function loadCollections() {
  const { data, error } = await supabase.from('experiment_collections')
    .select('id,name,created_at,updated_at').order('name')
  if (error) throw error
  collections = data ?? []
}
async function loadExperiments() {
  let query = supabase.from('experiments')
    .select('id,owner_id,collection_id,title,description,lifecycle,visibility,revision,updated_at')
    .eq('owner_id', user.id).order('updated_at', { ascending: false })
  if (selectedFilter === 'archived') query = query.eq('lifecycle', 'archived')
  else {
    query = query.eq('lifecycle', 'active')
    if (selectedFilter === 'unfiled') query = query.is('collection_id', null)
    else if (selectedFilter !== 'all') query = query.eq('collection_id', selectedFilter)
  }
  const { data, error } = await query
  if (error) throw error
  experiments = data ?? []
}
async function readExperiment(id) {
  const { data, error } = await supabase.from('experiments').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Experiment no longer exists or is not visible to this user.')
  return data
}
function collectionName(id) {
  return collections.find((c) => c.id === id)?.name ?? 'Unfiled'
}
function renderCollectionSelect() {
  const intended = selected?.collection_id ?? els.collectionSelect.value ?? ''
  els.collectionSelect.innerHTML = '<option value="">Unfiled</option>'
  for (const c of collections) {
    const option = document.createElement('option')
    option.value = c.id
    option.textContent = c.name
    els.collectionSelect.append(option)
  }
  els.collectionSelect.value = intended
}
function renderCollections() {
  els.collections.innerHTML = ''
  for (const c of collections) {
    const button = document.createElement('button')
    button.className = `nav${selectedFilter === c.id ? ' active' : ''}`
    button.dataset.collection = c.id
    button.textContent = c.name
    els.collections.append(button)
  }
  document.querySelectorAll('button.nav').forEach((button) => {
    button.classList.toggle('active', button.dataset.collection === selectedFilter)
  })
  renderCollectionSelect()
}
function renderExperiments() {
  els.experiments.innerHTML = ''
  if (!experiments.length) {
    const empty = document.createElement('p')
    empty.className = 'muted'
    empty.textContent = 'No experiments in this view.'
    els.experiments.append(empty)
    return
  }
  for (const exp of experiments) {
    const button = document.createElement('button')
    button.className = selected?.id === exp.id ? 'active' : ''
    button.dataset.experiment = exp.id
    button.innerHTML = `<strong>${escapeHtml(exp.title)}</strong><br><span class="muted">${escapeHtml(collectionName(exp.collection_id))} · r${exp.revision}</span>`
    els.experiments.append(button)
  }
}
function renderEditor() {
  if (!selected) {
    els.emptyEditor.hidden = false
    els.form.hidden = true
    return
  }
  els.emptyEditor.hidden = true
  els.form.hidden = false
  els.title.value = selected.title
  els.description.value = selected.description ?? ''
  renderCollectionSelect()
  els.collectionSelect.value = selected.collection_id ?? ''
  els.revision.textContent = selected.revision
  els.lifecycle.textContent = selected.lifecycle
  els.configSource.value = selected.config_source
  els.initializerSource.value = selected.initializer_source
  els.controllerSource.value = selected.controller_source
  els.archive.hidden = selected.lifecycle === 'archived'
  els.restore.hidden = selected.lifecycle !== 'archived'
  dirty = false
  setSync(`Synced · revision ${selected.revision}`)
}
async function selectExperiment(id) {
  if (dirty && !confirm('Discard unsaved local edits and open another experiment?')) return
  selected = await readExperiment(id)
  renderExperiments()
  renderEditor()
}
async function refreshWorkspace({ preserveSelection = true } = {}) {
  setSync('Refreshing…')
  await Promise.all([loadCollections(), loadExperiments()])
  renderCollections()
  renderExperiments()
  if (preserveSelection && selected) {
    const stillListed = experiments.some((item) => item.id === selected.id)
    if (!stillListed && !dirty) selected = null
  }
  renderEditor()
  if (!selected) setSync('Synced')
}
async function createCollection() {
  const name = prompt('Collection/project name')?.trim()
  if (!name) return
  const { error } = await supabase.from('experiment_collections').insert({ owner_id: user.id, name })
  if (error) throw error
  await loadCollections()
  renderCollections()
  showMessage(`Collection “${name}” created.`)
}
async function createExperiment() {
  if (dirty && !confirm('Discard unsaved local edits and create a new experiment?')) return
  const initialCollection = selectedFilter !== 'all' && selectedFilter !== 'unfiled' && selectedFilter !== 'archived'
    ? selectedFilter : null
  const { data, error } = await supabase.from('experiments').insert({
    owner_id: user.id, collection_id: initialCollection, title: 'Untitled experiment', description: '',
    config_source: '', initializer_source: '', controller_source: '',
    created_by_actor: 'human', updated_by_actor: 'human',
  }).select('*').single()
  if (error) throw error
  selectedFilter = initialCollection ?? 'all'
  selected = data
  await refreshWorkspace()
  renderEditor()
  els.title.focus()
  els.title.select()
}
async function saveExperiment(event) {
  event.preventDefault()
  if (!selected) return
  setSync('Saving…')
  const patch = {
    title: els.title.value.trim(), description: els.description.value,
    collection_id: els.collectionSelect.value || null,
    config_source: els.configSource.value, initializer_source: els.initializerSource.value,
    controller_source: els.controllerSource.value, updated_by_actor: 'human', updated_by_ai_client: null,
  }
  if (!patch.title) throw new Error('Experiment title cannot be empty.')
  const { data, error } = await supabase.from('experiments').update(patch)
    .eq('id', selected.id).eq('revision', selected.revision).select('*').maybeSingle()
  if (error) throw error
  if (!data) {
    setSync('Conflict')
    throw new Error('Save rejected: this experiment changed remotely. Refresh it before applying your edit.')
  }
  selected = data
  dirty = false
  await refreshWorkspace()
  renderEditor()
}
async function setLifecycle(lifecycle) {
  if (!selected) return
  const { data, error } = await supabase.from('experiments')
    .update({ lifecycle, updated_by_actor: 'human', updated_by_ai_client: null })
    .eq('id', selected.id).eq('revision', selected.revision).select('*').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Lifecycle change rejected because the experiment changed remotely. Refresh first.')
  selected = data
  dirty = false
  selectedFilter = lifecycle === 'archived' ? 'archived' : 'all'
  await refreshWorkspace()
}
async function permanentlyDelete() {
  if (!selected) return
  const name = selected.title
  if (!confirm(`Permanently delete working experiment “${name}”? This cannot be undone.`)) return
  const { data, error } = await supabase.from('experiments').delete()
    .eq('id', selected.id).eq('revision', selected.revision).select('id').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Delete rejected because the experiment changed remotely. Refresh first.')
  selected = null
  dirty = false
  await refreshWorkspace({ preserveSelection: false })
}
async function pollSelected() {
  if (!user || !selected) return
  try {
    const remote = await readExperiment(selected.id)
    if (remote.revision <= selected.revision) return
    if (dirty) {
      setSync(`Remote revision ${remote.revision} available · local edits unsaved`)
      return
    }
    selected = remote
    renderEditor()
    await loadExperiments()
    renderExperiments()
    showMessage(`Remote update received: ${remote.title} is now revision ${remote.revision}.`)
  } catch {
    setSync('Sync check failed')
  }
}
async function renderConsent() {
  if (!authorizationId || !user) return false
  const oauth = supabase.auth.oauth
  if (!oauth) throw new Error('OAuth client methods are unavailable. Reload this page to fetch the current mock-sim client.')
  const { data, error } = await oauth.getAuthorizationDetails(authorizationId)
  if (error) throw error
  if (!data) throw new Error('OAuth authorization request was not found.')
  if (!('authorization_id' in data)) {
    if (!data.redirect_url) throw new Error('OAuth authorization response did not include a redirect URL.')
    location.assign(data.redirect_url)
    return true
  }
  els.authPanel.hidden = true
  els.workspace.hidden = true
  els.consentPanel.hidden = false
  els.oauthClient.textContent = data.client?.name ?? 'AI client'
  els.oauthScopes.textContent = data.scope?.trim() || 'email'
  return true
}
async function initializeSession() {
  const { data } = await supabase.auth.getSession()
  user = data.session?.user ?? null
  if (!user) {
    profile = null
    els.identity.textContent = 'Signed out'
    els.authPanel.hidden = false
    els.consentPanel.hidden = true
    els.workspace.hidden = true
    clearInterval(pollTimer)
    return
  }
  profile = await registryProfile()
  els.identity.textContent = profile.display_name
  els.workspaceUser.textContent = `${profile.display_name} · ${user.email ?? user.id}`
  if (await renderConsent()) return
  els.authPanel.hidden = true
  els.consentPanel.hidden = true
  els.workspace.hidden = false
  await refreshWorkspace()
  clearInterval(pollTimer)
  pollTimer = setInterval(pollSelected, 2500)
}
async function authenticate(mode) {
  showMessage('')
  const email = els.email.value.trim()
  const password = els.password.value
  if (!email || !password) throw new Error('Enter email and password.')
  if (mode === 'signin') {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  } else {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        data: { display_name: email.split('@')[0] },
        emailRedirectTo: 'https://eliseofe.github.io/virtual-lab-mock-sim/',
      },
    })
    if (error) throw error
    if (!data.session) showMessage('Account created. Confirm the email, then return to your AI client and reconnect.')
  }
  await initializeSession()
}
async function run(action) {
  try { await action() }
  catch (error) {
    console.error(error)
    showMessage(error.message ?? String(error), 'error')
  }
}

els.signIn.addEventListener('click', () => run(() => authenticate('signin')))
els.signUp.addEventListener('click', () => run(() => authenticate('signup')))
els.signOut.addEventListener('click', () => run(async () => {
  clearInterval(pollTimer)
  await supabase.auth.signOut()
  selected = null
  await initializeSession()
}))
els.refresh.addEventListener('click', () => run(async () => {
  if (selected) {
    if (dirty && !confirm('Discard unsaved local edits and refresh from the registry?')) return
    selected = await readExperiment(selected.id)
    dirty = false
  }
  await refreshWorkspace()
}))
els.newCollection.addEventListener('click', () => run(createCollection))
els.newExperiment.addEventListener('click', () => run(createExperiment))
els.form.addEventListener('submit', (event) => run(() => saveExperiment(event)))
els.archive.addEventListener('click', () => run(() => setLifecycle('archived')))
els.restore.addEventListener('click', () => run(() => setLifecycle('active')))
els.delete.addEventListener('click', () => run(permanentlyDelete))
els.experiments.addEventListener('click', (event) => {
  const button = event.target.closest('[data-experiment]')
  if (button) run(() => selectExperiment(button.dataset.experiment))
})
document.querySelector('.sidebar').addEventListener('click', (event) => {
  const button = event.target.closest('button.nav[data-collection]')
  if (!button) return
  run(async () => {
    if (dirty && !confirm('Discard unsaved local edits and change view?')) return
    dirty = false
    selected = null
    selectedFilter = button.dataset.collection
    await refreshWorkspace({ preserveSelection: false })
  })
})
for (const input of [els.title, els.description, els.collectionSelect, els.configSource, els.initializerSource, els.controllerSource]) {
  const markDirty = () => {
    if (!selected) return
    dirty = true
    setSync(`Local edits · base revision ${selected.revision}`)
  }
  input.addEventListener('input', markDirty)
  input.addEventListener('change', markDirty)
}
els.oauthApprove.addEventListener('click', () => run(async () => {
  const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId)
  if (error) throw error
  location.assign(data.redirect_url)
}))
els.oauthDeny.addEventListener('click', () => run(async () => {
  const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId)
  if (error) throw error
  location.assign(data.redirect_url)
}))

supabase.auth.onAuthStateChange(() => { queueMicrotask(() => run(initializeSession)) })
run(initializeSession)
