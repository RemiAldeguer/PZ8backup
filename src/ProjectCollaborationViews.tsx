import { canProject } from '../shared/permissions';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AtSign, Download, ExternalLink, FileImage, FileText, Folder, FolderPlus, ChevronRight, Link2, MessageSquare, Pencil, Plus, Search, Send, Trash2, Upload, X } from 'lucide-react';
import type { AppData, Comment, DocumentFolder, Mutation, Project, ProjectDocument, Resource, Task, ViewProps } from '../shared/types';
import { commentIsOwn, commentMentionsUser, discussionThreads, personalDiscussionThreads, type DiscussionThread, type PersonalDiscussionFilter } from '../shared/discussions';
import { documentFolderDescendantIds, documentFolderPath, documentFoldersByPath } from '../shared/document-folders';
import { Modal } from './Dialogs';
import './project-collaboration.css';

const MAX_DOCUMENT_BYTES = 512 * 1024;
const FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const ACCEPT_FILES = Object.keys(FILE_TYPES).map(extension => `.${extension}`).join(',');
function failure(error: unknown): string { return error instanceof Error ? error.message : 'L’enregistrement a échoué. Réessayez.'; }
function isLocked(project: Project): boolean { return project.status === 'closed' || project.status === 'paused'; }
function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : 'Date inconnue';
}
function safeWebUrl(value: string | null | undefined): string | undefined {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined; } catch { return undefined; }
}
function ownContent(item: { authorId?: string; authorName: string }, data: AppData): boolean {
  return data.currentUser.role === 'Administrateur' || (item.authorId ? item.authorId === data.currentUser.id : item.authorName === data.currentUser.name);
}
function avatarTextColor(color: string): string {
  const channels = color.match(/[a-f\d]{2}/gi)?.slice(0, 3).map(channel => {
    const normalized = Number.parseInt(channel, 16) / 255;
    return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
  });
  if (!channels || channels.length !== 3) return '#fff';
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2] > .179 ? '#172b33' : '#fff';
}
function documentBytes(item: ProjectDocument): Uint8Array {
  const raw = atob(item.contentBase64 ?? '');
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}
function downloadDocument(item: ProjectDocument): void {
  const blob = new Blob([documentBytes(item) as BlobPart], { type: item.mimeType ?? 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = item.fileName ?? item.name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function ResourceAvatar({ resource, name }: { resource?: Resource; name?: string }) {
  return <span className="pcv-avatar" style={resource ? { backgroundColor: resource.color, color: avatarTextColor(resource.color) } : undefined} aria-hidden="true">{resource?.initials ?? (name ?? '?').split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2)}</span>;
}
function LockedNotice({ project }: { project: Project }) {
  return isLocked(project) ? <p className="pcv-notice">Ce projet est {project.status === 'closed' ? 'clos' : 'interrompu'}. Ses documents et discussions sont disponibles en lecture.</p> : null;
}

function documentLocation(folders: DocumentFolder[], folderId: string | null | undefined): string {
  return ['Documents', ...documentFolderPath(folders, folderId).map(folder => folder.name)].join(' / ');
}
function useDocumentDraftGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
}
function FolderDestinationSelect({ folders, folderId, onChange, label, excludeId }: {
  folders: DocumentFolder[]; folderId: string | null; onChange: (id: string | null) => void; label: string; excludeId?: string;
}) {
  const excluded = excludeId ? documentFolderDescendantIds(folders, excludeId) : new Set<string>();
  return <label className="form-field">{label}<select className="form-input" value={folderId ?? ''} onChange={event => onChange(event.target.value || null)}>
    <option value="">Documents (racine)</option>
    {documentFoldersByPath(folders).filter(folder => !excluded.has(folder.id)).map(folder => <option key={folder.id} value={folder.id}>{documentLocation(folders, folder.id)}</option>)}
  </select></label>;
}

export function GlobalDocumentsView(props: ViewProps) {
  const { data, notify } = props;
  const [query, setQuery] = useState(''); const [projectId, setProjectId] = useState('');
  const [kind, setKind] = useState<'all' | 'file' | 'link'>('all');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ projectId: string; kind: 'file' | 'link'; document?: ProjectDocument } | null>(null);
  const [creation, setCreation] = useState<{ kind: 'file' | 'link'; projectId: string } | null>(null);
  const projects = useMemo(() => new Map(data.projects.map(project => [project.id, project])), [data.projects]);
  const folders = useMemo(() => new Map(data.projects.map(project => [project.id, (data.documentFolders ?? []).filter(folder => folder.projectId === project.id)])), [data.projects, data.documentFolders]);
  const selectedProjectId = projects.has(projectId) ? projectId : '';
  const allDocuments = (data.projectDocuments ?? []).filter(item => projects.has(item.projectId));
  const search = query.trim().toLocaleLowerCase('fr');
  const location = (item: ProjectDocument) => documentLocation(folders.get(item.projectId) ?? [], item.folderId);
  const documents = allDocuments.filter(item => (!selectedProjectId || item.projectId === selectedProjectId) && (kind === 'all' || item.kind === kind)
    && (!search || `${item.name} ${item.description} ${item.fileName ?? ''} ${item.authorName} ${projects.get(item.projectId)!.name} ${location(item)}`.toLocaleLowerCase('fr').includes(search)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const writableProjects = data.projects.filter(project => !isLocked(project) && canProject(data, project.id, 'documents'));
  const editorProject = editor ? projects.get(editor.projectId) : undefined;
  const creationProjects = writableProjects.filter(project => creation?.kind !== 'link' || canProject(data, project.id, 'externalLink'));
  const creationProject = creation ? creationProjects.find(project => project.id === creation.projectId) : undefined;
  const preview = allDocuments.find(item => item.id === previewId);
  const projectUrl = (item: ProjectDocument) => `#project/${encodeURIComponent(item.projectId)}/documents${item.folderId ? `/${encodeURIComponent(item.folderId)}` : ''}`;
  function add(kind: 'file' | 'link') { setCreation({ kind, projectId: writableProjects.some(project => project.id === selectedProjectId) ? selectedProjectId : '' }); }
  return <div className="pcv-view pcv-global-documents">
    <header className="pcv-heading"><div><h1>Documents</h1><p>Retrouvez les fichiers et liens partagés dans tous vos projets.</p></div><div className="pcv-actions"><button className="button button-secondary" disabled={!writableProjects.some(project => canProject(data, project.id, 'externalLink'))} onClick={() => add('link')}><Link2 size={16} />Ajouter un lien</button><button className="button button-primary" disabled={!writableProjects.length} onClick={() => add('file')}><Upload size={16} />Ajouter un document</button></div></header>
    <section className="pcv-card" aria-label="Documents de tous les projets">
      <div className="pcv-card-heading"><h2>Tous les documents <span className="pcv-count">{documents.length}</span></h2><label className="pcv-search"><Search size={16} /><input type="search" aria-label="Rechercher dans tous les documents" placeholder="Document, projet ou dossier…" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
      <div className="pcv-global-filters"><label>Projet<select className="form-input" aria-label="Filtrer les documents par projet" value={selectedProjectId} onChange={event => setProjectId(event.target.value)}><option value="">Tous les projets</option>{data.projects.map(project => <option key={project.id} value={project.id}>{project.name}{isLocked(project) ? ' · Lecture seule' : ''}</option>)}</select></label><label>Type<select className="form-input" aria-label="Filtrer les documents par type" value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="all">Fichiers et liens</option><option value="file">Fichiers</option><option value="link">Liens web</option></select></label><span className="pcv-global-result-count">{documents.length} / {allDocuments.length} documents</span>{(search || selectedProjectId || kind !== 'all') && <button type="button" className="pcv-text-action" onClick={() => { setQuery(''); setProjectId(''); setKind('all'); }}>Réinitialiser les filtres</button>}</div>
      {documents.length ? <div className="pcv-document-list">{documents.map(item => {
        const project = projects.get(item.projectId)!; const webUrl = safeWebUrl(item.url); const canEdit = !isLocked(project) && canProject(data, project.id, item.kind === 'link' ? 'externalLink' : 'documents') && ownContent(item, data);
        return <article className="pcv-document" key={item.id} data-document-id={item.id}>
          <span className={`pcv-document-icon pcv-document-${item.kind}`} aria-hidden="true">{item.kind === 'link' ? <Link2 size={23} /> : item.mimeType?.startsWith('image/') ? <FileImage size={23} /> : <FileText size={23} />}</span>
          <div className="pcv-document-info"><button type="button" className="pcv-document-name" onClick={() => setPreviewId(item.id)}>{item.name}</button>{item.description && <p>{item.description}</p>}<small>{item.authorName} · {dateLabel(item.createdAt)} · {item.kind === 'file' ? `${((item.sizeBytes ?? 0) / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko` : 'Lien web'}</small><a className="pcv-document-location" href={projectUrl(item)} aria-label={`Ouvrir le dossier de ${item.name}`}><Folder size={12} />{project.name} / {location(item)}</a>{isLocked(project) && <small className="pcv-global-readonly">Projet en lecture seule</small>}</div>
          <div className="pcv-document-actions">{item.kind === 'link' ? webUrl && <a className="pcv-icon-action" href={webUrl} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${item.name}`} title="Ouvrir le lien"><ExternalLink size={18} /></a> : <button type="button" className="pcv-icon-action" aria-label={`Télécharger ${item.name}`} title="Télécharger" onClick={() => { try { downloadDocument(item); } catch (error) { notify(failure(error)); } }}><Download size={18} /></button>}{canEdit && <button type="button" className="pcv-icon-action" aria-label={`Modifier ${item.name}`} title="Modifier ou déplacer le document" onClick={() => setEditor({ projectId: project.id, kind: item.kind, document: item })}><Pencil size={17} /></button>}</div>
        </article>;
      })}</div> : <div className="pcv-empty"><Folder size={34} /><strong>{allDocuments.length ? 'Aucun document trouvé' : 'Aucun document dans cet espace'}</strong><p>{allDocuments.length ? 'Modifiez la recherche ou les filtres pour retrouver vos documents.' : 'Ajoutez un fichier ou un lien à un projet pour le retrouver ici.'}</p></div>}
    </section>
    {creation && <Modal title="Choisir le projet du document" onClose={() => setCreation(null)}><form onSubmit={event => { event.preventDefault(); if (creationProject) { setEditor({ projectId: creationProject.id, kind: creation.kind }); setCreation(null); } }}><div className="modal-body"><label className="form-field">Projet du document<select className="form-input" required value={creationProject?.id ?? ''} onChange={event => setCreation({ ...creation, projectId: event.target.value })}><option value="" disabled>Choisir un projet</option>{creationProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><p className="pcv-file-hint">Le document sera partagé avec l’équipe de ce projet. Les projets clos ou interrompus restent en lecture seule.</p></div><div className="modal-footer"><button type="button" className="button button-secondary" onClick={() => setCreation(null)}>Annuler</button><button className="button button-primary" disabled={!creationProject}>Continuer</button></div></form></Modal>}
    {editor && editorProject && <DocumentEditor key={`${editorProject.id}-${editor.document?.id ?? editor.kind}`} {...props} project={editorProject} kind={editor.kind} item={editor.document ?? null} initialFolderId={editor.document?.folderId ?? null} onClose={() => setEditor(null)} />}
    {preview && <DocumentPreview item={preview} location={`${projects.get(preview.projectId)!.name} / ${location(preview)}`} notify={notify} onClose={() => setPreviewId(null)} />}
  </div>;
}

export function DocumentsView(props: ViewProps & { initialFolderId?: string }) {
  const { data, project, mutate, notify } = props;
  const [query, setQuery] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(props.initialFolderId ?? null);
  const [editor, setEditor] = useState<{ kind: 'file' | 'link'; document?: ProjectDocument; folderId: string | null } | null>(null);
  const [folderEditor, setFolderEditor] = useState<{ folder?: DocumentFolder; parentId: string | null } | null>(null);
  const [preview, setPreview] = useState<ProjectDocument | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const deletion = useRef(false);
  const folders = useMemo(() => (data.documentFolders ?? []).filter(folder => folder.projectId === project.id), [data.documentFolders, project.id]);
  const folderId = folders.some(folder => folder.id === selectedFolderId) ? selectedFolderId : null;
  const folderPath = documentFolderPath(folders, folderId);
  const allDocuments = (data.projectDocuments ?? []).filter(item => item.projectId === project.id);
  const search = query.trim().toLocaleLowerCase('fr');
  const searching = search.length > 0;
  const documents = allDocuments.filter(item => searching
    ? `${item.name} ${item.description} ${item.fileName ?? ''} ${item.authorName} ${documentLocation(folders, item.folderId)}`.toLocaleLowerCase('fr').includes(search)
    : (item.folderId ?? null) === folderId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const shownFolders = documentFoldersByPath(folders).filter(folder => searching
    ? documentLocation(folders, folder.id).toLocaleLowerCase('fr').includes(search)
    : folder.parentId === folderId);
  useEffect(() => { setSelectedFolderId(props.initialFolderId ?? null); setQuery(''); }, [project.id, props.initialFolderId]);
  function navigate(id: string | null) { setSelectedFolderId(id); setQuery(''); }
  function folderContents(id: string) {
    return { documents: allDocuments.filter(item => item.folderId === id).length, folders: folders.filter(folder => folder.parentId === id).length };
  }
  async function remove(item: ProjectDocument) {
    if (deletion.current || isLocked(project) || !ownContent(item, data) || !window.confirm(`Supprimer le document « ${item.name} » ?`)) return;
    deletion.current = true; setPendingDelete(item.id);
    try { await mutate('project-documents', 'DELETE', undefined, item.id); notify('Document supprimé.'); }
    catch (error) { notify(failure(error)); }
    finally { deletion.current = false; setPendingDelete(null); }
  }
  async function removeFolder(folder: DocumentFolder) {
    const content = folderContents(folder.id);
    if (deletion.current || isLocked(project) || !ownContent(folder, data) || content.documents || content.folders || !window.confirm(`Supprimer le dossier vide « ${folder.name} » ?`)) return;
    deletion.current = true; setPendingDelete(folder.id);
    try { await mutate('document-folders', 'DELETE', undefined, folder.id); if (folderId === folder.id) navigate(folder.parentId); notify('Dossier supprimé.'); }
    catch (error) { notify(failure(error)); }
    finally { deletion.current = false; setPendingDelete(null); }
  }
  return <div className="pcv-view pcv-documents">
    <header className="pcv-heading"><div><h1>Documents</h1><p>Les fichiers, liens et dossiers partagés pour {project.name}.</p></div><div className="pcv-actions"><button className="button button-secondary" disabled={isLocked(project) || !canProject(data, project.id, 'documents') || pendingDelete !== null} onClick={() => setFolderEditor({ parentId: folderId })}><FolderPlus size={16} />Nouveau dossier</button><button className="button button-secondary" disabled={isLocked(project) || !canProject(data, project.id, 'externalLink') || pendingDelete !== null} onClick={() => setEditor({ kind: 'link', folderId })}><Link2 size={16} />Ajouter un lien</button><button className="button button-primary" disabled={isLocked(project) || !canProject(data, project.id, 'documents') || pendingDelete !== null} onClick={() => setEditor({ kind: 'file', folderId })}><Upload size={16} />Ajouter un document</button></div></header>
    <LockedNotice project={project} />
    <div className="pcv-documents-layout">
      <aside className="pcv-card pcv-folder-navigation" aria-label="Dossiers de documents"><h2>Dossiers <span className="pcv-count">{folders.length}</span></h2><nav aria-label="Naviguer dans les dossiers"><ul>
        <li><button type="button" className={`pcv-folder-nav-button${folderId === null && !searching ? ' pcv-folder-nav-active' : ''}`} aria-current={folderId === null && !searching ? 'page' : undefined} onClick={() => navigate(null)}><Folder size={17} /><span>Documents</span><span className="pcv-count" title="Tous les documents du projet">{allDocuments.length}</span></button></li>
        {documentFoldersByPath(folders).map(folder => {
          const path = documentFolderPath(folders, folder.id); const descendants = documentFolderDescendantIds(folders, folder.id);
          const count = allDocuments.filter(item => item.folderId && descendants.has(item.folderId)).length;
          return <li key={folder.id}><button type="button" className={`pcv-folder-nav-button${folderId === folder.id && !searching ? ' pcv-folder-nav-active' : ''}`} style={{ paddingLeft: 12 + Math.min(path.length, 8) * 12 }} title={documentLocation(folders, folder.id)} aria-current={folderId === folder.id && !searching ? 'page' : undefined} onClick={() => navigate(folder.id)}><Folder size={16} /><span>{folder.name}</span><span className="pcv-count" title="Documents de ce dossier et de ses sous-dossiers">{count}</span></button></li>;
        })}
      </ul></nav></aside>
      <section className="pcv-card pcv-documents-content" aria-label="Documents du projet">
        <div className="pcv-card-heading"><h2>Documents du projet <span className="pcv-count">{allDocuments.length}</span></h2><label className="pcv-search"><Search size={16} /><input aria-label="Rechercher un document" type="search" placeholder="Rechercher dans tous les dossiers…" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
        <div className="pcv-folder-toolbar"><nav className="pcv-folder-breadcrumb" aria-label="Chemin du dossier"><button type="button" onClick={() => navigate(null)}><Folder size={15} />Documents</button>{folderPath.map((folder, index) => <span key={folder.id}><ChevronRight size={13} /><button type="button" aria-current={!searching && index === folderPath.length - 1 ? 'page' : undefined} onClick={() => navigate(folder.id)}>{folder.name}</button></span>)}</nav>{folderId && !searching && (() => {
          const current = folders.find(folder => folder.id === folderId)!; const content = folderContents(current.id); const canEdit = !isLocked(project) && canProject(data, project.id, 'documents') && ownContent(current, data);
          return canEdit && <div className="pcv-folder-toolbar-actions"><button type="button" className="pcv-text-action" disabled={pendingDelete !== null} onClick={() => setFolderEditor({ folder: current, parentId: current.parentId })}><Pencil size={14} />Modifier le dossier</button><button type="button" className="pcv-icon-action pcv-danger" aria-label={`Supprimer le dossier ${current.name}`} title={content.documents || content.folders ? 'Déplacez d’abord les documents et sous-dossiers pour supprimer ce dossier.' : 'Supprimer ce dossier vide'} disabled={pendingDelete !== null || content.documents > 0 || content.folders > 0} onClick={() => void removeFolder(current)}><Trash2 size={15} /></button></div>;
        })()}</div>
        {searching && <p className="pcv-folder-search-note">Recherche dans tous les dossiers du projet · {documents.length} document{documents.length > 1 ? 's' : ''} et {shownFolders.length} dossier{shownFolders.length > 1 ? 's' : ''}</p>}
        {shownFolders.length > 0 && <div className="pcv-folder-list" aria-label={searching ? 'Dossiers trouvés' : 'Sous-dossiers'}>{shownFolders.map(folder => {
          const content = folderContents(folder.id); const canEdit = !isLocked(project) && canProject(data, project.id, 'documents') && ownContent(folder, data);
          return <article className="pcv-document pcv-folder-row" key={folder.id}><span className="pcv-document-icon pcv-folder-icon" aria-hidden="true"><Folder size={24} /></span><div className="pcv-document-info"><button type="button" className="pcv-document-name" aria-label={`Ouvrir le dossier ${folder.name}`} onClick={() => navigate(folder.id)}>{folder.name}</button><small>{content.documents} document{content.documents > 1 ? 's' : ''} · {content.folders} sous-dossier{content.folders > 1 ? 's' : ''}</small>{searching && <small className="pcv-folder-search-location">{documentLocation(folders, folder.parentId)}</small>}</div><div className="pcv-document-actions">{canEdit && <><button type="button" className="pcv-icon-action" aria-label={`Modifier le dossier ${folder.name}`} title="Renommer ou déplacer le dossier" disabled={pendingDelete !== null} onClick={() => setFolderEditor({ folder, parentId: folder.parentId })}><Pencil size={17} /></button><button type="button" className="pcv-icon-action pcv-danger" aria-label={`Supprimer le dossier ${folder.name}`} title={content.documents || content.folders ? 'Déplacez d’abord les documents et sous-dossiers pour supprimer ce dossier.' : 'Supprimer ce dossier vide'} disabled={pendingDelete !== null || content.documents > 0 || content.folders > 0} onClick={() => void removeFolder(folder)}><Trash2 size={17} /></button></>}<button type="button" className="pcv-icon-action" aria-label={`Afficher le dossier ${folder.name}`} onClick={() => navigate(folder.id)}><ChevronRight size={18} /></button></div></article>;
        })}</div>}
        {documents.length ? <div className="pcv-document-list">{documents.map(item => {
          const webUrl = safeWebUrl(item.url); const canEdit = !isLocked(project) && canProject(data, project.id, item.kind === 'link' ? 'externalLink' : 'documents') && ownContent(item, data);
          return <article className="pcv-document" key={item.id}>
            <span className={`pcv-document-icon pcv-document-${item.kind}`} aria-hidden="true">{item.kind === 'link' ? <Link2 size={23} /> : item.mimeType?.startsWith('image/') ? <FileImage size={23} /> : <FileText size={23} />}</span>
            <div className="pcv-document-info"><button type="button" className="pcv-document-name" onClick={() => setPreview(item)}>{item.name}</button>{item.description && <p>{item.description}</p>}<small>{item.authorName} · {dateLabel(item.createdAt)}{item.kind === 'file' && item.sizeBytes !== null ? ` · ${(item.sizeBytes / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko` : ' · Lien web'}</small>{searching && <button type="button" className="pcv-document-location" onClick={() => navigate(item.folderId ?? null)}><Folder size={12} />{documentLocation(folders, item.folderId)}</button>}</div>
            <div className="pcv-document-actions">{item.kind === 'link' ? webUrl && <a className="pcv-icon-action" href={webUrl} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${item.name}`} title="Ouvrir le lien"><ExternalLink size={18} /></a> : <button type="button" className="pcv-icon-action" aria-label={`Télécharger ${item.name}`} title="Télécharger" onClick={() => { try { downloadDocument(item); } catch (error) { notify(failure(error)); } }}><Download size={18} /></button>}{canEdit && <><button type="button" className="pcv-icon-action" aria-label={`Modifier ${item.name}`} title="Modifier ou déplacer le document" disabled={pendingDelete !== null} onClick={() => setEditor({ kind: item.kind, document: item, folderId: item.folderId ?? null })}><Pencil size={17} /></button><button type="button" className="pcv-icon-action pcv-danger" aria-label={`Supprimer ${item.name}`} title="Supprimer" disabled={pendingDelete !== null} onClick={() => void remove(item)}><Trash2 size={17} /></button></>}</div>
          </article>;
        })}</div> : shownFolders.length === 0 && <div className="pcv-empty"><Folder size={34} /><strong>{searching ? 'Aucun document ou dossier trouvé' : folderId ? 'Ce dossier est vide' : 'Aucun document dans ce projet'}</strong><p>{searching ? 'Essayez un autre terme de recherche.' : 'Ajoutez un fichier, un lien ou un dossier pour le partager avec l’équipe.'}</p></div>}
      </section>
    </div>
    {editor && <DocumentEditor key={editor.document?.id ?? `${editor.kind}-${editor.folderId ?? 'root'}`} {...props} kind={editor.kind} item={editor.document ?? null} initialFolderId={editor.folderId} onClose={() => setEditor(null)} />}
    {folderEditor && <DocumentFolderEditor key={folderEditor.folder?.id ?? `new-${folderEditor.parentId ?? 'root'}`} {...props} item={folderEditor.folder ?? null} initialParentId={folderEditor.parentId} onClose={() => setFolderEditor(null)} />}
    {preview && <DocumentPreview item={preview} location={documentLocation(folders, preview.folderId)} notify={notify} onClose={() => setPreview(null)} />}
  </div>;
}

function DocumentFolderEditor({ data, project, mutate, notify, item, initialParentId, onClose }: ViewProps & { item: DocumentFolder | null; initialParentId: string | null; onClose: () => void }) {
  const [name, setName] = useState(item?.name ?? ''); const [parentId, setParentId] = useState<string | null>(item?.parentId ?? initialParentId);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const submitting = useRef(false);
  const folders = (data.documentFolders ?? []).filter(folder => folder.projectId === project.id);
  const dirty = name !== (item?.name ?? '') || parentId !== (item?.parentId ?? initialParentId);
  useDocumentDraftGuard(dirty);
  function close() { if (submitting.current) return; if (!dirty || window.confirm('Fermer sans enregistrer les modifications du dossier ?')) onClose(); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (submitting.current || isLocked(project) || (item && !ownContent(item, data))) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (!name.trim()) throw new Error('Renseignez le nom du dossier.');
      if (parentId && !folders.some(folder => folder.id === parentId)) throw new Error('Le dossier parent n’existe plus. Sélectionnez un autre emplacement.');
      if (item && parentId && documentFolderDescendantIds(folders, item.id).has(parentId)) throw new Error('Un dossier ne peut pas être déplacé dans l’un de ses sous-dossiers.');
      await mutate('document-folders', item ? 'PATCH' : 'POST', { name: name.trim(), parentId, ...(item ? {} : { projectId: project.id }) }, item?.id);
      notify(item ? 'Dossier mis à jour.' : 'Dossier créé.'); onClose();
    } catch (err) { setError(failure(err)); } finally { submitting.current = false; setBusy(false); }
  }
  return <Modal title={item ? 'Modifier le dossier' : 'Créer un dossier'} onClose={close}>
    <form className="pcv-document-form" onSubmit={save}><div className="modal-body"><fieldset disabled={busy || isLocked(project)}>
      <label className="form-field">Nom du dossier<input className="form-input" required maxLength={200} value={name} onChange={event => setName(event.target.value)} placeholder="Ex. : Contrats" /></label>
      <FolderDestinationSelect folders={folders} folderId={parentId} onChange={setParentId} label="Dossier parent" excludeId={item?.id} />
    </fieldset>{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-footer"><button type="button" className="button button-secondary" onClick={close} disabled={busy}>Annuler</button><button className="button button-primary" disabled={busy || isLocked(project)}>{busy ? 'Enregistrement…' : item ? 'Enregistrer' : 'Créer'}</button></div></form>
  </Modal>;
}

function DocumentEditor({ data, project, mutate, notify, kind, item, initialFolderId, onClose }: ViewProps & { kind: 'file' | 'link'; item: ProjectDocument | null; initialFolderId: string | null; onClose: () => void }) {
  const [name, setName] = useState(item?.name ?? ''); const [description, setDescription] = useState(item?.description ?? '');
  const [url, setUrl] = useState(item?.url ?? ''); const [file, setFile] = useState<File | null>(null);
  const [folderId, setFolderId] = useState<string | null>(item?.folderId ?? initialFolderId);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const submitting = useRef(false);
  const folders = (data.documentFolders ?? []).filter(folder => folder.projectId === project.id);
  const dirty = name !== (item?.name ?? '') || description !== (item?.description ?? '') || url !== (item?.url ?? '') || file !== null || folderId !== (item?.folderId ?? initialFolderId);
  useDocumentDraftGuard(dirty);
  function close() { if (submitting.current) return; if (!dirty || window.confirm('Fermer sans enregistrer les modifications du document ?')) onClose(); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (submitting.current || isLocked(project) || (item && !ownContent(item, data))) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const common = { name: name.trim(), description: description.trim(), folderId };
      if (!common.name) throw new Error('Renseignez le nom du document.');
      if (folderId && !folders.some(folder => folder.id === folderId)) throw new Error('Le dossier n’existe plus. Sélectionnez un autre emplacement.');
      if (kind === 'link' && !safeWebUrl(url.trim())) throw new Error('Renseignez un lien web commençant par https:// ou http://.');
      if (item) await mutate('project-documents', 'PATCH', { ...common, ...(kind === 'link' ? { url: url.trim() } : {}) }, item.id);
      else if (kind === 'link') await mutate('project-documents', 'POST', { ...common, projectId: project.id, kind, url: url.trim() });
      else {
        if (!file) throw new Error('Sélectionnez un fichier.');
        if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Le fichier dépasse la limite de 512 Ko.');
        const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
        const mimeType = FILE_TYPES[extension];
        if (!mimeType) throw new Error('Ce format de fichier n’est pas pris en charge.');
        await mutate('project-documents', 'POST', { ...common, projectId: project.id, kind, fileName: file.name, mimeType, contentBase64: await fileBase64(file) });
      }
      notify(item ? 'Document mis à jour.' : kind === 'link' ? 'Lien ajouté au projet.' : 'Document ajouté au projet.'); onClose();
    } catch (err) { setError(failure(err)); } finally { submitting.current = false; setBusy(false); }
  }
  return <Modal title={item ? 'Modifier le document' : kind === 'file' ? 'Ajouter un document' : 'Ajouter un lien web'} onClose={close}>
    <form className="pcv-document-form" onSubmit={save}><div className="modal-body"><fieldset disabled={busy || isLocked(project)}>
      <label className="form-field">Nom du document<input className="form-input" required maxLength={200} value={name} onChange={event => setName(event.target.value)} placeholder="Ex. : Cahier des charges" /></label>
      <FolderDestinationSelect folders={folders} folderId={folderId} onChange={setFolderId} label="Dossier du document" />
      {kind === 'link' && <label className="form-field">Lien web<input className="form-input" type="url" required maxLength={2000} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" /></label>}
      {kind === 'file' && !item && <label className="form-field">Fichier<input className="form-input pcv-file-input" type="file" accept={ACCEPT_FILES} required onChange={event => { const selected = event.target.files?.[0] ?? null; setFile(selected); if (!name && selected) setName(selected.name); setError(''); }} /><span className="pcv-file-hint">512 Ko maximum. PDF, texte, CSV, images PNG/JPEG/GIF/WebP, Word, Excel ou PowerPoint.</span></label>}
      {kind === 'file' && item && <p className="pcv-file-hint">Fichier : {item.fileName}. Ajoutez un nouveau document pour partager une autre version.</p>}
      <label className="form-field">Description<textarea className="form-input" rows={3} maxLength={10000} value={description} onChange={event => setDescription(event.target.value)} placeholder="Informations utiles à l’équipe…" /></label>
    </fieldset>{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-footer"><button type="button" className="button button-secondary" onClick={close} disabled={busy}>Annuler</button><button className="button button-primary" disabled={busy || isLocked(project)}>{busy ? 'Enregistrement…' : item ? 'Enregistrer' : 'Ajouter'}</button></div></form>
  </Modal>;
}

function DocumentPreview({ item, location, notify, onClose }: { item: ProjectDocument; location: string; notify: (message: string) => void; onClose: () => void }) {
  const url = safeWebUrl(item.url);
  const image = item.kind === 'file' && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(item.mimeType ?? '') && item.contentBase64;
  const text = useMemo(() => {
    if (item.kind !== 'file' || !['text/plain', 'text/csv'].includes(item.mimeType ?? '')) return null;
    try { const decoded = new TextDecoder().decode(documentBytes(item)); return { body: decoded.slice(0, 20000), truncated: decoded.length > 20000 }; } catch { return null; }
  }, [item]);
  return <Modal title={item.name} onClose={onClose} large><div className="modal-body pcv-preview">
    <p className="pcv-preview-meta">Ajouté par {item.authorName} · {dateLabel(item.createdAt)}<span className="pcv-preview-location"><Folder size={13} />{location}</span></p>
    {item.description && <p className="pcv-prewrap">{item.description}</p>}
    {image ? <img src={`data:${item.mimeType};base64,${item.contentBase64}`} alt={item.name} /> : text !== null ? <><pre>{text.body}</pre>{text.truncated && <p className="pcv-file-hint">Aperçu limité à 20 000 caractères. Téléchargez le fichier pour le consulter en entier.</p>}</> : item.kind === 'file' ? <div className="pcv-preview-file"><FileText size={42} /><strong>{item.fileName}</strong><p>Téléchargez ce document pour le consulter.</p></div> : url ? <a className="pcv-link" href={url} rel="noopener noreferrer" target="_blank">{url}<ExternalLink size={16} /></a> : <p>Lien indisponible.</p>}
  </div><div className="modal-footer"><button className="button button-secondary" onClick={onClose}>Fermer</button>{item.kind === 'file' ? <button className="button button-primary" onClick={() => { try { downloadDocument(item); } catch (error) { notify(failure(error)); } }}><Download size={16} />Télécharger</button> : url && <a className="button button-primary" href={url} rel="noopener noreferrer" target="_blank"><ExternalLink size={16} />Ouvrir le lien</a>}</div></Modal>;
}

type DiscussionContext = { data: AppData; project: Project; task: Task | null; mutate: Mutation; notify: (message: string) => void };

function CommentComposer({ data, project, task, mutate, notify, editing, onEdited, onCancel, disabled = false, onBusyChange }: DiscussionContext & {
  editing?: Comment | null; onEdited?: () => void; onCancel?: () => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const [body, setBody] = useState(editing?.body ?? '');
  const [mentions, setMentions] = useState<string[]>([...(editing?.mentionResourceIds ?? [])]);
  const [pickerOpen, setPickerOpen] = useState(false); const [mentionQuery, setMentionQuery] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const sending = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mentionStart = useRef<number | null>(null);
  const members = data.resources.filter(resource => resource.active || mentions.includes(resource.id))
    .filter(resource => resource.name.toLocaleLowerCase('fr').includes(mentionQuery.toLocaleLowerCase('fr')))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  useEffect(() => {
    if (body === (editing?.body ?? '') && JSON.stringify(mentions) === JSON.stringify(editing?.mentionResourceIds ?? [])) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [body, mentions, editing]);
  function changeBody(value: string) {
    setBody(value);
    setMentions(previous => previous.filter(id => {
      const resource = data.resources.find(item => item.id === id);
      return !resource || value.includes(`@${resource.name}`);
    }));
    const typed = value.match(/(?:^|\s)@([^@\n]{0,80})$/);
    const alreadyNamed = typed && data.resources.some(resource => typed[1].startsWith(`${resource.name} `));
    if (typed && !alreadyNamed) { mentionStart.current = value.lastIndexOf('@'); setMentionQuery(typed[1]); setPickerOpen(true); }
    else { mentionStart.current = null; setPickerOpen(false); }
  }
  function mention(resource: Resource) {
    const start = mentionStart.current;
    setMentions(previous => [...new Set([...previous, resource.id])]);
    setBody(previous => start !== null
      ? `${previous.slice(0, start)}@${resource.name} ` : `${previous}${previous && !/\s$/.test(previous) ? ' ' : ''}@${resource.name} `);
    mentionStart.current = null;
    setPickerOpen(false); setMentionQuery(''); textarea.current?.focus();
  }
  function cancel() {
    const changed = body !== (editing?.body ?? '') || JSON.stringify(mentions) !== JSON.stringify(editing?.mentionResourceIds ?? []);
    if (!changed || window.confirm('Annuler les modifications du commentaire ?')) onCancel?.();
  }
  async function send(event: FormEvent) {
    event.preventDefault(); if (sending.current || disabled || isLocked(project) || !body.trim()) return;
    sending.current = true; setBusy(true); onBusyChange?.(true); setError('');
    try {
      const content = { body: body.trim(), mentionResourceIds: [...new Set(mentions)] };
      await mutate('comments', editing ? 'PATCH' : 'POST', editing ? content : { ...content, projectId: project.id, taskId: task?.id ?? null }, editing?.id);
      setBody(''); setMentions([]); setPickerOpen(false);
      notify(editing ? 'Commentaire mis à jour.' : 'Commentaire publié.'); onEdited?.();
    } catch (err) { setError(failure(err)); } finally { sending.current = false; setBusy(false); onBusyChange?.(false); }
  }
  if (isLocked(project)) return null;
  return <form className="pcv-composer" onSubmit={send} aria-label={editing ? 'Modifier le commentaire' : 'Ajouter un commentaire'}>
    <label className="sr-only">Votre commentaire</label><textarea ref={textarea} className="form-input" aria-label="Votre commentaire" rows={4} maxLength={10000} required disabled={busy || disabled} value={body} onChange={event => changeBody(event.target.value)} onKeyDown={event => { if (pickerOpen && event.key === 'Escape') { event.stopPropagation(); setPickerOpen(false); mentionStart.current = null; } }} placeholder="Écrire un commentaire… Utilisez @ pour mentionner une ressource." />
    {mentions.length > 0 && <div className="pcv-mention-chips" aria-label="Ressources mentionnées">{mentions.map(id => {
      const resource = data.resources.find(item => item.id === id);
      return <span className="pcv-mention-chip" key={id}>@{resource?.name ?? 'Ressource historique'}<button type="button" aria-label={`Retirer la mention ${resource?.name ?? id}`} disabled={busy || disabled} onClick={() => setMentions(previous => previous.filter(item => item !== id))}><X size={13} /></button></span>;
    })}</div>}
    {pickerOpen && <div className="pcv-mention-picker"><label className="pcv-search"><Search size={15} /><input type="search" aria-label="Rechercher une ressource à mentionner" placeholder="Rechercher une ressource…" value={mentionQuery} disabled={busy || disabled} onChange={event => setMentionQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (members[0]) mention(members[0]); } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPickerOpen(false); mentionStart.current = null; textarea.current?.focus(); } }} /></label><div className="pcv-mention-options">{members.length ? members.slice(0, 25).map(resource => <button key={resource.id} type="button" aria-label={resource.name} disabled={busy || disabled} onClick={() => mention(resource)}><ResourceAvatar resource={resource} /><span>{resource.name}</span>{mentions.includes(resource.id) && <small>mentionnée</small>}</button>) : <p>Aucune ressource trouvée.</p>}</div></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="pcv-composer-actions"><button type="button" className="pcv-text-action" aria-label="Mentionner une ressource" disabled={busy || disabled} onClick={() => { mentionStart.current = null; setPickerOpen(previous => !previous); setMentionQuery(''); }}><AtSign size={16} />Mentionner</button>{editing && <button type="button" className="button button-secondary" disabled={busy || disabled} onClick={cancel}>Annuler</button>}<button className="button button-primary" disabled={busy || disabled || !body.trim()}><Send size={15} />{busy ? 'Envoi…' : editing ? 'Enregistrer le commentaire' : 'Envoyer'}</button></div>
  </form>;
}

function CommentFeed({ data, project, task, mutate, notify, comments }: DiscussionContext & { comments: Comment[] }) {
  const [editing, setEditing] = useState<Comment | null>(null); const [deleting, setDeleting] = useState<string | null>(null);
  const [editingBusy, setEditingBusy] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => { if (editing && !comments.some(comment => comment.id === editing.id)) setEditing(null); }, [comments, editing]);
  async function remove(comment: Comment) {
    if (inFlight.current || editingBusy || isLocked(project) || !ownContent(comment, data) || !window.confirm('Supprimer ce commentaire ?')) return;
    inFlight.current = true; setDeleting(comment.id);
    try { await mutate('comments', 'DELETE', undefined, comment.id); if (editing?.id === comment.id) setEditing(null); notify('Commentaire supprimé.'); }
    catch (error) { notify(failure(error)); }
    finally { inFlight.current = false; setDeleting(null); }
  }
  return <div className="pcv-discussion-content">
    <div className="pcv-comment-feed" aria-label="Commentaires">
      {comments.length ? comments.map(comment => {
        const author = data.resources.find(resource => resource.id === comment.authorId);
        const canEdit = !isLocked(project) && ownContent(comment, data);
        return <article key={comment.id} className={`pcv-comment${commentMentionsUser(comment, data.currentUser.id) ? ' pcv-comment-mentioned' : ''}`}>
          <header className="pcv-comment-heading"><ResourceAvatar resource={author} name={comment.authorName} /><div><strong>{comment.authorName}</strong><time dateTime={comment.createdAt}>{dateLabel(comment.createdAt)}{comment.updatedAt && comment.updatedAt !== comment.createdAt ? ' · modifié' : ''}</time></div>{canEdit && <div className="pcv-comment-actions"><button type="button" className="pcv-icon-action" aria-label={`Modifier le commentaire de ${comment.authorName}`} disabled={deleting !== null || editingBusy} onClick={() => { if (!editing || editing.id === comment.id || window.confirm('Abandonner la modification du commentaire en cours ?')) setEditing(comment); }}><Pencil size={15} /></button><button type="button" className="pcv-icon-action pcv-danger" aria-label={`Supprimer le commentaire de ${comment.authorName}`} disabled={deleting !== null || editingBusy} onClick={() => void remove(comment)}><Trash2 size={15} /></button></div>}</header>
          {editing?.id === comment.id ? <CommentComposer key={`edit-${comment.id}`} data={data} project={project} task={task} mutate={mutate} notify={notify} editing={editing} disabled={deleting !== null} onBusyChange={setEditingBusy} onEdited={() => setEditing(null)} onCancel={() => setEditing(null)} /> : <><p className="pcv-comment-body">{comment.body}</p>{(comment.mentionResourceIds ?? []).length > 0 && <div className="pcv-comment-mentions">{comment.mentionResourceIds?.map(id => <span key={id} className={id === data.currentUser.id ? 'pcv-mention-self' : ''}>@{data.resources.find(resource => resource.id === id)?.name ?? 'Ressource historique'}</span>)}</div>}</>}
        </article>;
      }) : <div className="pcv-empty pcv-empty-compact"><MessageSquare size={28} /><p>Lancez la discussion avec l’équipe.</p></div>}
    </div>
    {!editing && <CommentComposer data={data} project={project} task={task} mutate={mutate} notify={notify} disabled={deleting !== null} />}
  </div>;
}

export function TaskDiscussion({ data, task, project, mutate, notify }: DiscussionContext & { task: Task }) {
  const thread = discussionThreads(data, project.id).find(item => item.task?.id === task.id);
  const comments = thread?.comments ?? [];
  return <aside className="pcv-task-discussion"><h3><MessageSquare size={18} />Discussion <span className="pcv-count">{comments.length}</span></h3><LockedNotice project={project} /><CommentFeed key={task.id} data={data} task={task} project={project} mutate={mutate} notify={notify} comments={comments} /></aside>;
}

function threadMatches(thread: DiscussionThread, query: string): boolean {
  const text = `${thread.project.name} ${thread.task?.title ?? 'Discussion du projet'} ${thread.comments.map(comment => `${comment.body} ${comment.authorName}`).join(' ')}`;
  return text.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr'));
}
function ThreadButton({ thread, selected, personal, onSelect }: { thread: DiscussionThread; selected: boolean; personal?: boolean; onSelect: () => void }) {
  const last = thread.comments.at(-1);
  const title = thread.task?.title ?? 'Discussion du projet';
  return <button type="button" className={`pcv-thread-button${selected ? ' pcv-thread-selected' : ''}`} aria-label={title} aria-pressed={selected} onClick={onSelect}>
    <span className="pcv-thread-title"><MessageSquare size={16} /><strong>{title}</strong><span className="pcv-count">{thread.comments.length}</span></span>
    {personal && <small className="pcv-thread-project">{thread.project.name}</small>}
    {last ? <><span className="pcv-thread-excerpt">{last.authorName} : {last.body}</span><time dateTime={last.createdAt}>{dateLabel(last.createdAt)}</time></> : <span className="pcv-thread-excerpt">Commencer une discussion</span>}
    {personal && <span className="pcv-thread-flags">{thread.mentioned && <span><AtSign size={12} />Mentionné</span>}{thread.participated && <span>Commenté</span>}</span>}
  </button>;
}
function ThreadPanel({ thread, props, personal = false }: { thread: DiscussionThread; props: ViewProps; personal?: boolean }) {
  return <section className="pcv-thread-panel pcv-card" aria-label={`Fil : ${thread.task?.title ?? thread.project.name}`}>
    <header className="pcv-thread-panel-heading"><div><span>{personal ? thread.project.name : thread.task ? 'Discussion de tâche' : 'Discussion du projet'}</span><h2>{thread.task?.title ?? thread.project.name}</h2></div><div className="pcv-thread-context-actions">{personal && <button type="button" className="pcv-text-action" onClick={() => props.openProject(thread.project)}><Folder size={15} />Ouvrir le projet</button>}{thread.task && <button type="button" className="pcv-text-action" onClick={() => props.openTask(thread.task!)}><ExternalLink size={15} />Ouvrir la tâche</button>}</div></header>
    <LockedNotice project={thread.project} />
    <CommentFeed key={thread.id} data={props.data} project={thread.project} task={thread.task} mutate={props.mutate} notify={props.notify} comments={thread.comments} />
  </section>;
}

export function DiscussionsView(props: ViewProps) {
  const { data, project } = props;
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(`project:${project.id}`);
  const threads = discussionThreads(data, project.id, true);
  const visible = threads.filter(thread => threadMatches(thread, query) && (filter === 'all' || (filter === 'project' ? !thread.task : !!thread.task)));
  const selectedTask = selectedId.startsWith('task:') ? data.tasks.find(task => `task:${task.id}` === selectedId && task.projectId === project.id) : undefined;
  const selected = threads.find(thread => thread.id === selectedId) ?? (selectedTask ? { id: selectedId, project, task: selectedTask, comments: [], mentioned: false, participated: false, latestAt: '' } : threads.find(thread => !thread.task)!);
  useEffect(() => { setSelectedId(`project:${project.id}`); setQuery(''); setFilter('all'); }, [project.id]);
  return <div className="pcv-view pcv-discussions">
    <header className="pcv-heading"><div><h1>Discussions du projet</h1><p>Retrouvez les échanges du projet et de ses tâches.</p></div><label className="pcv-thread-create">Discuter de<select className="form-input" aria-label="Discuter de" value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value={`project:${project.id}`}>Discussion du projet</option>{data.tasks.filter(task => task.projectId === project.id).sort((a, b) => a.title.localeCompare(b.title, 'fr')).map(task => <option key={task.id} value={`task:${task.id}`}>{task.title}</option>)}</select></label></header>
    <div className="pcv-discussion-layout"><aside className="pcv-threads pcv-card"><div className="pcv-thread-filters"><label className="pcv-search"><Search size={16} /><input type="search" aria-label="Rechercher une discussion" placeholder="Rechercher une discussion…" value={query} onChange={event => setQuery(event.target.value)} /></label><select className="form-input" aria-label="Filtrer les discussions du projet" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Projet et tâches</option><option value="project">Projet</option><option value="tasks">Tâches</option></select></div><div className="pcv-thread-list">{visible.length ? visible.map(thread => <ThreadButton key={thread.id} thread={thread} selected={thread.id === selected.id} onSelect={() => setSelectedId(thread.id)} />) : <div className="pcv-empty pcv-empty-compact"><MessageSquare size={26} /><p>Aucune discussion trouvée.</p></div>}</div></aside>{selected && <ThreadPanel thread={selected} props={props} />}</div>
  </div>;
}

export function PersonalDiscussionsView(props: ViewProps) {
  const [filter, setFilter] = useState<PersonalDiscussionFilter>('all'); const [query, setQuery] = useState(''); const [selectedId, setSelectedId] = useState('');
  const threads = personalDiscussionThreads(props.data, filter).filter(thread => threadMatches(thread, query));
  const selected = threads.find(thread => thread.id === selectedId) ?? threads[0];
  const labels: { value: PersonalDiscussionFilter; label: string }[] = [{ value: 'all', label: 'Toutes' }, { value: 'mentioned', label: 'Où je suis mentionné' }, { value: 'participated', label: 'Où j’ai commenté' }];
  return <div className="pcv-view pcv-personal-discussions">
    <header className="pcv-heading"><div><h1>Mes discussions</h1><p>Les échanges où vous êtes mentionné ou avez laissé un commentaire.</p></div></header>
    <div className="pcv-personal-tabs" role="group" aria-label="Filtrer mes discussions">{labels.map(item => <button type="button" key={item.value} className={filter === item.value ? 'pcv-tab-active' : ''} aria-pressed={filter === item.value} onClick={() => { setFilter(item.value); setSelectedId(''); }}>{item.label}<span>{personalDiscussionThreads(props.data, item.value).length}</span></button>)}</div>
    {threads.length || query ? <div className="pcv-discussion-layout"><aside className="pcv-threads pcv-card"><div className="pcv-thread-filters"><label className="pcv-search"><Search size={16} /><input type="search" aria-label="Rechercher dans mes discussions" placeholder="Rechercher une discussion…" value={query} onChange={event => setQuery(event.target.value)} /></label></div><div className="pcv-thread-list">{threads.length ? threads.map(thread => <ThreadButton key={thread.id} thread={thread} selected={thread.id === selected?.id} personal onSelect={() => setSelectedId(thread.id)} />) : <div className="pcv-empty pcv-empty-compact"><p>Aucune discussion trouvée.</p></div>}</div></aside>{selected && <ThreadPanel thread={selected} props={props} personal />}</div> : <section className="pcv-card pcv-empty"><MessageSquare size={36} /><strong>{filter === 'mentioned' ? 'Aucune mention pour le moment' : filter === 'participated' ? 'Vous n’avez pas encore commenté' : 'Aucune discussion pour le moment'}</strong><p>Les discussions de projet et de tâche apparaîtront ici dès que vous y participerez ou qu’une ressource vous mentionnera.</p></section>}
  </div>;
}
