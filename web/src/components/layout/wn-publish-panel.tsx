import { useEffect, useId, useState } from "react";
import { Button, Input, Modal } from "antd";
import { ArrowRight, CheckCircle2, ExternalLink, FileCheck2, RefreshCw, TriangleAlert } from "lucide-react";
import { releaseNotesFromRecords } from "./wn-publish-content";
import "./wn-publish-panel.css";

type Change = { path: string; change: string; bytes?: number };
export type PublisherStatus = {
    mode: "developer"; baselineVersion: string; baselineId: string; reviewId: string;
    changes: Change[]; maintenanceChanges: Change[]; dependencyChanges: Change[]; buildContextChanges: Change[];
    unreleasedNotes: string; buildRequired: boolean;
    draft: { id: string; version: string; fromVersion: string; status: string; files: number; bytes: number; zipSha256: string; uploadUrl: string; notes: string; changes: Change[] } | null;
};
type Props = {
    status: PublisherStatus | null; busy: boolean; en: boolean; error?: string;
    onRefresh: () => void;
    onPrepare: (version: string, notes: string, reviewId: string) => Promise<boolean>;
    onApprove: (id: string) => Promise<boolean>;
    onVerify: (id: string) => Promise<boolean>;
};

export function WnPublishPanel({ status, busy, en, error, onRefresh, onPrepare, onApprove, onVerify }: Props) {
    const text = (zh: string, english: string) => en ? english : zh;
    const formId = useId();
    const [version, setVersion] = useState(() => `WN-${new Date().toLocaleDateString("sv-SE").replaceAll("-", "")}-01`);
    const [notes, setNotes] = useState("");
    const [prepareNew, setPrepareNew] = useState(false);
    const [reviewOpen, setReviewOpen] = useState(false);
    const [reviewedId, setReviewedId] = useState<string | null>(null);
    const [replaceNotesOpen, setReplaceNotesOpen] = useState(false);
    const draft = status?.draft;
    const editing = !draft || prepareNew;
    const published = draft?.status === "published";
    const approved = draft?.status === "approved";
    const suggestedNotes = releaseNotesFromRecords(status?.unreleasedNotes || "");
    useEffect(() => { setPrepareNew(false); setReviewOpen(false); }, [draft?.id]);
    useEffect(() => { if (reviewOpen && draft?.id !== reviewedId) setReviewOpen(false); }, [draft?.id, reviewedId, reviewOpen]);
    const blockers = status ? [
        ...(status.maintenanceChanges.length ? [text(`${status.maintenanceChanges.length} 项更新工具改动需要新版引导包`, `${status.maintenanceChanges.length} updater changes need a new bootstrap`)] : []),
        ...(status.dependencyChanges.length ? [text("依赖改动需要单独交付", "Dependency changes require a separate delivery")] : []),
        ...(status.buildContextChanges.length ? [text("构建配置改动需要先验证交付", "Build changes need a validated delivery")] : []),
    ] : [];
    const formReason = !status ? error ? text("请刷新发布状态后重试。", "Refresh release status and try again.") : text("等待读取发布状态", "Waiting for release status")
        : blockers.length ? blockers.join(en ? "; " : "；")
        : !status.changes.length ? text("当前没有未发布的程序改动。", "There are no unpublished program changes.")
        : !/^WN-\d{8}-\d{2}$/.test(version) ? text("版本格式应为 WN-YYYYMMDD-NN。", "Use the version format WN-YYYYMMDD-NN.")
        : version <= status.baselineVersion ? text("拟发布版本必须高于已发布版本。", "The proposed version must be newer than the published version.")
        : !notes.trim() ? text("填写更新说明，或引用已有待发布记录。", "Write release notes or import the recorded changes.")
        : notes.length > 12000 ? text("更新说明超过 12,000 字，请精简后准备。", "Release notes exceed 12,000 characters. Shorten them first.") : "";
    const stage = editing ? 0 : published ? 3 : approved ? 2 : 1;
    const phase = !status ? error ? text("发布状态读取失败", "Could not read release status") : text("正在读取发布状态…", "Reading release status…") : editing ? text("尚未生成发布包", "No release archive prepared") : published ? text("已发布 · 公网核验通过", "Published · verified online") : approved ? text("已确认 · 等待上传核验", "Approved · awaiting upload verification") : text("已准备 · 等待确认", "Prepared · awaiting approval");
    const startNew = () => {
        if (status && version <= status.baselineVersion) setVersion(`${status.baselineVersion.slice(0, -2)}${String(Number(status.baselineVersion.slice(-2)) + 1).padStart(2, "0")}`);
        setPrepareNew(true);
    };
    const importNotes = () => {
        if (notes.trim() && notes !== suggestedNotes) setReplaceNotesOpen(true);
        else setNotes(suggestedNotes);
    };
    return <div className="wn-publish-panel">
        <div className="wn-publish-overview">
            <div className="wn-publish-statusline">
                <span className="wn-publish-mode">{text("开发者端", "Developer")}</span>
                <span>{text("已发布", "Published")} <strong>{status?.baselineVersion || "—"}</strong></span>
                <span>{status ? text(`${status.changes.length} 项未发布`, `${status.changes.length} unpublished files`) : error ? text("读取失败", "Read failed") : text("正在读取…", "Loading…")}</span>
            </div>
            <Button type="text" size="small" disabled={busy} icon={<RefreshCw size={14} />} onClick={onRefresh}>{text("刷新发布状态", "Refresh release status")}</Button>
        </div>
        <ol className="wn-publish-steps" aria-label={text("发布流程", "Release workflow")}>
            {[text("准备发布包", "Prepare"), text("确认上传范围", "Approve"), text("上传并核验", "Upload and verify")].map((label, index) => <li key={label} className={index === stage || stage === 3 && index === 2 ? "is-current" : index < stage ? "is-complete" : ""} aria-current={index === stage ? "step" : undefined}>
                <span>{index < stage ? <CheckCircle2 size={14} /> : <span className="wn-publish-step-dot" />}{label}</span>{index < 2 && <ArrowRight size={12} aria-hidden="true" />}
            </li>)}
        </ol>
        <div className="wn-publish-layout">
            <section className="wn-publish-column wn-publish-changes" aria-label={text("本次改动", "Release changes")}>
                <h3>{editing ? text("本次改动", "Release changes") : text("冻结的发布内容", "Frozen release content")}</h3>
                {!status ? <div className="wn-publish-loading" role="status">{error ? text("无法获取发布状态，请刷新重试。", "Could not get release status. Refresh and try again.") : text("正在对照已发布版本…", "Comparing with the published version…")}</div> : editing ? <>
                    <p className="wn-publish-caption">{text("这里的本地修改尚未上传。", "These local changes have not been uploaded.")}</p>
                    <ChangeList title={text("未发布文件", "Unpublished files")} changes={status.changes} en={en} />
                    {suggestedNotes ? <div className="wn-publish-records">{suggestedNotes}</div> : <p className="wn-publish-empty">{text(status.changes.length ? "有文件改动，尚未记录内容摘要。可直接填写更新说明。" : "程序文件与正式基线一致。修改程序后刷新，即可查看待发布内容。", status.changes.length ? "Files have changed, but no summary is recorded. Write release notes in the form." : "Program files match the published baseline. Refresh after making changes.")}</p>}
                    <details className="wn-publish-details"><summary>{text("查看原始待发布记录", "View original release records")}</summary><pre>{status.unreleasedNotes || text("暂无待发布记录。", "No release records yet.")}</pre></details>
                </> : draft && <>
                    <div className="wn-publish-draft-version">{draft.version}</div>
                    <p className="wn-publish-caption">{draft.fromVersion} <ArrowRight size={12} /> {draft.version}</p>
                    <p className="wn-publish-caption">{draft.files} {text("项文件操作", "file operations")} · {(draft.bytes / 1024 / 1024).toFixed(2)} MiB</p>
                    <div className="wn-publish-records">{draft.notes}</div>
                    <ChangeList title={text("草案冻结文件", "Frozen draft files")} changes={draft.changes} en={en} />
                    <details className="wn-publish-details"><summary>{text("上传包校验值", "Archive checksum")}</summary><code>{draft.zipSha256}</code></details>
                </>}
            </section>
            <section className="wn-publish-column wn-publish-settings" aria-label={editing ? text("发布设置", "Release settings") : text("发布草案", "Release draft")}>
                <h3>{editing ? text("发布设置", "Release settings") : text("当前发布状态", "Release status")}</h3>
                {error && <div className="wn-publish-notice is-error" role="alert"><strong>{text("发布操作未完成", "Release operation did not complete")}</strong><p>{error}</p></div>}
                {editing ? <>
                    {blockers.length > 0 && <div className="wn-publish-notice is-warning" role="status">
                        <strong><TriangleAlert size={16} />{text("暂不能准备发布包", "Preparation is blocked")}</strong>
                        <ul>{blockers.map(reason => <li key={reason}>{reason}</li>)}</ul>
                        <p>{text("这些文件无法通过普通在线包交付，需先完成对应维护。", "These files need a separate, validated delivery before an online release.")}</p>
                        {status && <>
                            {!!status.maintenanceChanges.length && <ChangeList title={text("查看维护文件", "View maintenance files")} changes={status.maintenanceChanges} en={en} />}
                            {!!status.dependencyChanges.length && <ChangeList title={text("查看依赖文件", "View dependency files")} changes={status.dependencyChanges} en={en} />}
                            {!!status.buildContextChanges.length && <ChangeList title={text("查看构建文件", "View build files")} changes={status.buildContextChanges} en={en} />}
                        </>}
                    </div>}
                    <div className="wn-publish-field"><label htmlFor={`${formId}-version`}>{text("拟发布版本", "Proposed version")}</label><Input id={`${formId}-version`} value={version} maxLength={16} onChange={event => setVersion(event.target.value)} disabled={busy || !status} placeholder="WN-YYYYMMDD-NN" /></div>
                    <div className="wn-publish-field">
                        <div className="wn-publish-field-heading"><label htmlFor={`${formId}-notes`}>{text("给用户的更新说明", "Release notes for users")} <span>{text("必填", "Required")}</span></label><Button type="text" size="small" disabled={busy || !suggestedNotes} onClick={importNotes}>{text("引用待发布记录", "Import release records")}</Button></div>
                        <Input.TextArea id={`${formId}-notes`} value={notes} onChange={event => setNotes(event.target.value)} disabled={busy || !status} rows={5} placeholder={text("写清本次新增、修复和使用变化，用户检查更新时会看到。", "Describe the features, fixes and changes users will see.")} />
                        <div className="wn-publish-notes-tools"><span className={notes.length > 12000 ? "is-over-limit" : ""}>{notes.length.toLocaleString()} / 12,000</span></div>
                    </div>
                    <p className="wn-publish-caption">{text("准备只在本地构建和校验；上传前还需要你确认范围。", "Preparation builds and verifies locally. You approve the scope before uploading.")}</p>
                    {draft && <Button type="text" disabled={busy} onClick={() => setPrepareNew(false)}>{text("返回现有草案", "Back to current draft")}</Button>}
                </> : draft && <>
                    <div className={`wn-publish-stage ${published ? "is-published" : ""}`}><FileCheck2 size={22} /><strong>{phase}</strong></div>
                    <p className="wn-publish-stage-description">{published ? text("服务器版本及全部程序文件已经核验。这份草案已登记为正式基线。", "The online version and all program files were verified. This draft is now the published baseline.") : approved ? text("这份冻结草案已获确认。下载 ZIP，在 Cloudflare 控制台部署后，再核验服务器上的实际版本。", "This frozen draft is approved. Download the ZIP, deploy it in Cloudflare, then verify the online version.") : text("发布包已在本地构建并校验，尚未上传。先检查冻结内容，再确认本次上传范围。", "The archive was built and verified locally. Review the frozen content before approving this upload.")}</p>
                    {approved && <div className="wn-publish-upload-actions"><Button href={`/api/wn-update/developer-download?draft=${draft.id}`} download>{text("下载上传包", "Download upload archive")}</Button><Button href={draft.uploadUrl} target="_blank" rel="noopener noreferrer" icon={<ExternalLink size={14} />}>{text("打开上传控制台", "Open upload dashboard")}</Button></div>}
                    <p className="wn-publish-caption">{text("确认不会自动上传；部署生效后用户即可检查到，核验通过才在本机登记已发布。", "Approval does not upload. Users can find the deployed release; local registration follows successful verification.")}</p>
                    {!published && <Button type="text" disabled={busy} onClick={startNew}>{text("重新准备发布包", "Prepare another archive")}</Button>}
                </>}
                <details className="wn-publish-details"><summary>{text("交付范围与使用条件", "Delivery scope and requirements")}</summary><p>{text("只更新程序，保留模型、运行时、依赖、作品和个人配置。用户须已安装所声明的来源版本；旧版需要过渡更新。Turbo 权重须单独交付。", "Program updates preserve models, runtimes, dependencies, projects and settings. Users must have the declared source version. Older installations need a transition; Turbo weights are delivered separately.")}</p></details>
            </section>
        </div>
        <footer className="wn-publish-footer">
            <div className="wn-publish-footer-copy" aria-live="polite"><strong>{busy ? text("正在处理，请稍候…", "Working, please wait…") : phase}</strong><p>{editing ? formReason || text("说明已填写，可以准备本地发布包。", "Release notes are ready. You can prepare the local archive.") : published ? text("本地新增改动将进入下一份发布草案。", "New local edits belong to the next release draft.") : approved ? text("完成手动部署后，再点击核验。", "Verify after completing the manual deployment.") : text("确认前不会开放上传包。", "The upload archive stays locked until approval.")}</p></div>
            {editing ? <Button type="primary" loading={busy} disabled={!!formReason || busy} onClick={() => status && void onPrepare(version, notes, status.reviewId)}>{text("准备发布包", "Prepare release archive")}</Button>
                : published ? <Button type="primary" disabled={busy} onClick={startNew}>{text("准备新版本", "Prepare a new version")}</Button>
                : approved ? <Button type="primary" loading={busy} onClick={() => draft && void onVerify(draft.id)}>{text("核验公网发布", "Verify online release")}</Button>
                : <Button type="primary" disabled={busy} onClick={() => { if (draft) { setReviewedId(draft.id); setReviewOpen(true); } }}>{text("确认上传范围", "Approve upload scope")}</Button>}
        </footer>
        <Modal className="wn-publish-review-modal" title={text("确认本次上传范围", "Approve this upload scope")} open={reviewOpen} onCancel={() => setReviewOpen(false)} onOk={async () => { if (reviewedId && await onApprove(reviewedId)) setReviewOpen(false); }} confirmLoading={busy} okText={text("确认，开放上传包", "Approve and unlock archive")} cancelText={text("返回检查", "Review again")} centered>
            <div className="wn-publish-review"><strong>{draft?.version}</strong><p>{draft?.fromVersion} → {draft?.version} · {draft?.files} {text("项文件操作", "file operations")}</p><p>{text("确认后由你下载 ZIP 并在 Cloudflare 上传。后续本地改动不会加入这份冻结草案。", "After approval, you download and upload the frozen ZIP. Later local edits are not included.")}</p><div className="wn-publish-records">{draft?.notes}</div>{draft && <ChangeList title={text("本次冻结文件", "Frozen files in this release")} changes={draft.changes} en={en} />}<details className="wn-publish-details"><summary>SHA256</summary><code>{draft?.zipSha256}</code></details></div>
        </Modal>
        <Modal className="wn-publish-review-modal" title={text("替换当前更新说明？", "Replace the current release notes?")} open={replaceNotesOpen} onCancel={() => setReplaceNotesOpen(false)} onOk={() => { setNotes(suggestedNotes); setReplaceNotesOpen(false); }} okText={text("引用并替换", "Import and replace")} cancelText={text("保留当前说明", "Keep current notes")} centered><p>{text("你已经填写了内容。引用待发布记录会替换当前说明，之后仍可编辑。", "You already entered notes. Importing the records replaces them, and you can edit the result.")}</p></Modal>
    </div>;
}

function ChangeList({ title, changes, en }: { title: string; changes: Change[]; en: boolean }) {
    return <details className="wn-publish-details"><summary>{title} <span>{changes.length}</span></summary><div className="wn-publish-files">{changes.length ? changes.map(change => <div key={change.path}><span>{change.change === "new" ? en ? "Added" : "新增" : change.change === "deleted" ? en ? "Deleted" : "删除" : en ? "Modified" : "修改"}</span><code>{change.path}</code></div>) : <p>{en ? "No unpublished files." : "暂无未发布文件。"}</p>}</div></details>;
}
