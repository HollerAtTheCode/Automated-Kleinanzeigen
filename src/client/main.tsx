import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, ExternalLink, ImagePlus, Loader2, Search, Send, Sparkles, Trash2 } from "lucide-react";
import type { ComparableListing, ListingDraft, ProductAnalysis, SessionState } from "../shared/types.js";
import "./styles.css";

type Step = "upload" | "analysis" | "pricing" | "draft" | "publish";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<ProductAnalysis | null>(null);
  const [comparables, setComparables] = useState<ComparableListing[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SessionState>("/api/session", { method: "POST" }).then(setSession).catch((err: Error) => setError(err.message));
  }, []);

  const run = async <T,>(label: string, task: () => Promise<T>) => {
    setBusy(label);
    setError(null);
    try {
      return await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      throw err;
    } finally {
      setBusy(null);
    }
  };

  const selectFiles = useCallback((incoming: FileList | File[]) => {
    const next = [...incoming].filter((file) => file.type.startsWith("image/"));
    setFiles((current) => [...current, ...next].slice(0, 12));
  }, []);

  const uploadAndAnalyze = async () => {
    if (!session || files.length === 0) return;
    await run("Bilder werden analysiert", async () => {
      const form = new FormData();
      files.forEach((file) => form.append("images", file));
      const uploaded = await api<SessionState>(`/api/session/${session.id}/images`, { method: "POST", body: form });
      setSession(uploaded);
      const result = await api<ProductAnalysis>(`/api/session/${session.id}/analyze`, { method: "POST" });
      setAnalysis(result);
      setStep("analysis");
    });
  };

  const searchPrices = async () => {
    if (!session || !analysis) return;
    await run("Vergleichsanzeigen werden gesucht", async () => {
      const result = await api<ComparableListing[]>(`/api/session/${session.id}/price-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: analysis.searchQueries })
      });
      setComparables(result);
      setStep("pricing");
    });
  };

  const generateDraft = async () => {
    if (!session) return;
    await run("Entwurf wird erstellt", async () => {
      const result = await api<ListingDraft>(`/api/session/${session.id}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludedListingIds: [...excluded] })
      });
      setDraft(result);
      setStep("draft");
    });
  };

  const publishAssist = async () => {
    if (!session) return;
    await run("Browser wird geoeffnet", async () => {
      await api(`/api/session/${session.id}/publish-assist`, { method: "POST" });
      setStep("publish");
    });
  };

  const activeComparables = useMemo(() => comparables.filter((listing) => !excluded.has(listing.id)), [comparables, excluded]);

  return (
    <main>
      <aside className="sidebar">
        <div className="brand">
          <Sparkles size={20} />
          <span>Entwurfsassistent</span>
        </div>
        <nav>
          {[
            ["upload", "Bilder"],
            ["analysis", "Produkt"],
            ["pricing", "Preise"],
            ["draft", "Entwurf"],
            ["publish", "Assist"]
          ].map(([id, label]) => (
            <button key={id} className={step === id ? "active" : ""} onClick={() => setStep(id as Step)}>
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header>
          <div>
            <h1>Lokaler Kleinanzeigen-Entwurf</h1>
            <p>Session-only Verarbeitung fuer Bilder, Analyse, Preise und Entwurf.</p>
          </div>
          {busy && (
            <span className="status">
              <Loader2 size={16} className="spin" />
              {busy}
            </span>
          )}
        </header>

        {error && <div className="error">{error}</div>}

        {step === "upload" && (
          <section
            className="panel dropzone"
            onDrop={(event) => {
              event.preventDefault();
              selectFiles(event.dataTransfer.files);
            }}
            onDragOver={(event) => event.preventDefault()}
          >
            <ImagePlus size={32} />
            <input id="images" type="file" accept="image/*" multiple onChange={(event) => event.target.files && selectFiles(event.target.files)} />
            <label htmlFor="images">Produktbilder auswaehlen</label>
            <div className="thumbs">
              {files.map((file, index) => (
                <figure key={`${file.name}-${index}`}>
                  <img src={URL.createObjectURL(file)} alt={`Produktbild ${index + 1}`} title={file.name} />
                </figure>
              ))}
            </div>
            <button className="primary" disabled={!files.length || !!busy} onClick={uploadAndAnalyze}>
              <Sparkles size={18} />
              Analyse starten
            </button>
          </section>
        )}

        {step === "analysis" && analysis && (
          <section className="grid two">
            <div className="panel">
              <h2>{[analysis.brand, analysis.model, analysis.productType].filter(Boolean).join(" ")}</h2>
              <dl>
                <dt>Zustand</dt>
                <dd>{analysis.condition}</dd>
                <dt>Sicherheit</dt>
                <dd>{Math.round(analysis.confidence * 100)}%</dd>
                <dt>Kategorie</dt>
                <dd>{analysis.suggestedCategory ?? "Offen"}</dd>
              </dl>
              <div className="chips">
                {Object.entries(analysis.detectedAttributes).map(([key, value]) => (
                  <span key={key}>{key}: {value}</span>
                ))}
              </div>
            </div>
            <div className="panel">
              <h2>Suchbegriffe</h2>
              <ul className="plain">
                {analysis.searchQueries.map((query) => (
                  <li key={query}>{query}</li>
                ))}
              </ul>
              <button className="primary" disabled={!!busy} onClick={searchPrices}>
                <Search size={18} />
                Preise suchen
              </button>
            </div>
          </section>
        )}

        {step === "pricing" && (
          <section className="panel">
            <div className="panelHeader">
              <div>
                <h2>Vergleichsanzeigen</h2>
                <p>{activeComparables.length} aktive Treffer in der Preislogik</p>
              </div>
              <button className="primary" disabled={!comparables.length || !!busy} onClick={generateDraft}>
                <Check size={18} />
                Entwurf erzeugen
              </button>
            </div>
            <div className="listings">
              {comparables.map((listing) => (
                <article key={listing.id} className={excluded.has(listing.id) ? "listing excluded" : "listing"}>
                  <button
                    className="icon"
                    title={excluded.has(listing.id) ? "Wieder einbeziehen" : "Ausschliessen"}
                    onClick={() =>
                      setExcluded((current) => {
                        const next = new Set(current);
                        next.has(listing.id) ? next.delete(listing.id) : next.add(listing.id);
                        return next;
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                  <div>
                    <h3>{listing.title}</h3>
                    <p>{listing.location || "Ort unbekannt"} · Score {listing.score.toFixed(2)}</p>
                  </div>
                  <strong>{listing.price ? `${listing.price} EUR` : "VB"}</strong>
                  <a href={listing.url} target="_blank" rel="noreferrer" title="Quelle oeffnen">
                    <ExternalLink size={16} />
                  </a>
                </article>
              ))}
            </div>
          </section>
        )}

        {step === "draft" && draft && (
          <section className="grid two">
            <div className="panel">
              <h2>{draft.title}</h2>
              <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
              <button className="primary" disabled={!!busy} onClick={publishAssist}>
                <Send size={18} />
                Nach Pruefung befuellen
              </button>
            </div>
            <div className="panel">
              <h2>Preisvorschlag</h2>
              <div className="price">{draft.price.suggestedPrice ? `${draft.price.suggestedPrice} EUR` : "Offen"}</div>
              <p>{draft.price.rationale}</p>
              <dl>
                <dt>Median</dt>
                <dd>{draft.price.medianPrice ?? "n/a"}</dd>
                <dt>Gewichtete Mitte</dt>
                <dd>{draft.price.weightedMidPrice ?? "n/a"}</dd>
                <dt>Stichprobe</dt>
                <dd>{draft.price.sampleSize}</dd>
              </dl>
              {draft.missingFacts.length > 0 && <p className="note">{draft.missingFacts.join(" · ")}</p>}
            </div>
          </section>
        )}

        {step === "publish" && (
          <section className="panel done">
            <Check size={40} />
            <h2>Browserflow gestartet</h2>
            <p>Der separate Kleinanzeigen-Browser nutzt ein persistentes lokales Profil. Die finale Veroeffentlichung bleibt manuell.</p>
          </section>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
