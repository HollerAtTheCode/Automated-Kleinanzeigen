import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, ExternalLink, ImagePlus, Loader2, Search, Send, Sparkles, Trash2 } from "lucide-react";
import type { ComparableListing, ListingDraft, ProductAnalysis, SessionState } from "../shared/types.js";
import "./styles.css";

type Step = "upload" | "analysis" | "pricing" | "draft" | "publish";

type Settings = {
  hasOpenaiApiKey: boolean;
  openaiModel: string;
};

const conditionLabels: Record<ProductAnalysis["condition"], string> = {
  new: "Neu",
  like_new: "Wie neu",
  good: "Gut",
  fair: "Gebraucht",
  defective: "Defekt",
  unknown: "Bitte auswählen"
};

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
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [analysis, setAnalysis] = useState<ProductAnalysis | null>(null);
  const [productForm, setProductForm] = useState({
    productType: "",
    brand: "",
    model: "",
    condition: "unknown" as ProductAnalysis["condition"],
    category: "",
    notes: ""
  });
  const [comparables, setComparables] = useState<ComparableListing[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SessionState>("/api/session", { method: "POST" }).then(setSession).catch((err: Error) => setError(err.message));
    api<Settings>("/api/settings").then(setSettings).catch((err: Error) => setError(err.message));
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
    if (!session || files.length === 0 || !settings?.hasOpenaiApiKey) return;
    await run("Bilder werden analysiert", async () => {
      const form = new FormData();
      files.forEach((file) => form.append("images", file));
      const uploaded = await api<SessionState>(`/api/session/${session.id}/images`, { method: "POST", body: form });
      setSession(uploaded);
      const result = await api<ProductAnalysis>(`/api/session/${session.id}/analyze`, { method: "POST" });
      setAnalysis(result);
      setProductForm({
        productType: result.productType === "Unbekannter Artikel" ? "" : result.productType,
        brand: result.brand ?? "",
        model: result.model ?? "",
        condition: result.condition,
        category: result.suggestedCategory && result.suggestedCategory !== "Sonstiges" ? result.suggestedCategory : "",
        notes: result.saleNotes ?? ""
      });
      setStep("analysis");
    });
  };

  const saveApiKey = async () => {
    await run("API-Key wird verbunden", async () => {
      const updated = await api<Settings>("/api/settings/openai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey })
      });
      setSettings(updated);
      setApiKey("");
    });
  };

  const buildSearchQueries = (data = productForm) => {
    const primary = [data.brand, data.model, data.productType].filter(Boolean).join(" ").trim();
    const fallback = data.productType.trim();
    return [...new Set([primary, fallback, ...(analysis?.searchQueries ?? [])].filter((query) => query.length > 2))].slice(0, 4);
  };

  const saveProductDetails = async () => {
    if (!session || !analysis) return null;
    const productType = productForm.productType.trim();
    const category = productForm.category.trim();
    if (!productType || productForm.condition === "unknown" || !category) {
      setError("Bitte fülle Produkt, Zustand und Kategorie aus.");
      return null;
    }

    return run("Angaben werden gespeichert", async () => {
      const updated = await api<ProductAnalysis>(`/api/session/${session.id}/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...analysis,
          productType,
          brand: productForm.brand.trim() || undefined,
          model: productForm.model.trim() || undefined,
          condition: productForm.condition,
          suggestedCategory: category,
          saleNotes: productForm.notes.trim(),
          searchQueries: buildSearchQueries()
        })
      });
      setAnalysis(updated);
      return updated;
    });
  };

  const searchPrices = async () => {
    if (!session || !analysis) return;
    const updatedAnalysis = await saveProductDetails();
    if (!updatedAnalysis) return;
    await run("Vergleichsangebote werden gesucht", async () => {
      const result = await api<ComparableListing[]>(`/api/session/${session.id}/price-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: updatedAnalysis.searchQueries })
      });
      setComparables(result);
      const notesResult = await api<{ saleNotes: string }>(`/api/session/${session.id}/sale-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: productForm.notes })
      });
      if (notesResult.saleNotes) {
        setProductForm((current) => ({ ...current, notes: notesResult.saleNotes }));
        setAnalysis((current) => (current ? { ...current, saleNotes: notesResult.saleNotes } : current));
      }
      setStep("pricing");
    });
  };

  const generateDraft = async () => {
    if (!session) return;
    await run("Anzeige wird vorbereitet", async () => {
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
    await run("Browser wird geöffnet", async () => {
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
          <span>Verkaufsassistent</span>
        </div>
        <nav>
          {[
            ["upload", "Bilder"],
            ["analysis", "Produkt"],
            ["pricing", "Marktpreise"],
            ["draft", "Anzeige"],
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
            <h1>Kleinanzeigen Verkaufsassistent</h1>
            <p>Fotos auswerten, Marktpreise vergleichen und die Anzeige vorbereiten.</p>
          </div>
        </header>

        {error && <div className="error">{error}</div>}
        {busy && (
          <div className="busyOverlay" role="status" aria-live="polite">
            <div className="busyDialog">
              <Loader2 size={34} className="spin" />
              <strong>{busy}</strong>
            </div>
          </div>
        )}

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
            {!settings?.hasOpenaiApiKey && (
              <div className="setupPanel">
                <h2>Automatische Analyse aktivieren</h2>
                <p>Für die Bilderkennung braucht die App einen OpenAI API-Key. Der Key wird nur lokal im laufenden Serverprozess gehalten.</p>
                <div className="keyRow">
                  <input
                    type="password"
                    value={apiKey}
                    placeholder="OpenAI API-Key"
                    autoComplete="off"
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <button className="primary" disabled={apiKey.trim().length < 20 || !!busy} onClick={saveApiKey}>
                    Verbinden
                  </button>
                </div>
              </div>
            )}
            <input id="images" type="file" accept="image/*" multiple onChange={(event) => event.target.files && selectFiles(event.target.files)} />
            <label htmlFor="images">Produktbilder auswählen</label>
            <div className="thumbs">
              {files.map((file, index) => (
                <figure key={`${file.name}-${index}`}>
                  <img src={URL.createObjectURL(file)} alt={`Produktbild ${index + 1}`} title={file.name} />
                </figure>
              ))}
            </div>
            <button className="primary" disabled={!files.length || !settings?.hasOpenaiApiKey || !!busy} onClick={uploadAndAnalyze}>
              <Sparkles size={18} />
              Analyse starten
            </button>
          </section>
        )}

        {step === "analysis" && analysis && (
          <section className="productStep">
            <form className="panel formPanel productForm" onSubmit={(event) => event.preventDefault()}>
              <h2>Produktangaben</h2>
              <div className="formGrid">
                <label>
                  Produkt
                  <input value={productForm.productType} onChange={(event) => setProductForm({ ...productForm, productType: event.target.value })} />
                </label>
                <label>
                  Marke
                  <input value={productForm.brand} onChange={(event) => setProductForm({ ...productForm, brand: event.target.value })} />
                </label>
                <label>
                  Modell
                  <input value={productForm.model} onChange={(event) => setProductForm({ ...productForm, model: event.target.value })} />
                </label>
                <label>
                  Zustand
                  <select
                    value={productForm.condition}
                    onChange={(event) => setProductForm({ ...productForm, condition: event.target.value as ProductAnalysis["condition"] })}
                  >
                    {Object.entries(conditionLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="spanTwo">
                  Kategorie
                  <input value={productForm.category} onChange={(event) => setProductForm({ ...productForm, category: event.target.value })} />
                </label>
                <label className="spanTwo">
                  Hinweise oder Mängel
                  <textarea
                    className="compact"
                    value={productForm.notes}
                    onChange={(event) => setProductForm({ ...productForm, notes: event.target.value })}
                  />
                </label>
              </div>
              <button className="primary nextAction" disabled={!!busy} onClick={searchPrices}>
                <Search size={18} />
                Vergleichsangebote finden
              </button>
            </form>
          </section>
        )}

        {step === "pricing" && (
          <section className="panel">
            <div className="panelHeader">
              <div>
                <h2>Vergleichsangebote</h2>
                <p>{activeComparables.length} Angebote werden für den Preisvorschlag berücksichtigt</p>
              </div>
              <button className="primary" disabled={!comparables.length || !!busy} onClick={generateDraft}>
                <Check size={18} />
                Anzeige vorbereiten
              </button>
            </div>
            <div className="listings">
              {comparables.length === 0 && (
                <div className="emptyState">
                  <h3>Keine Vergleichsangebote gefunden</h3>
                  <p>Prüfe Produkt, Marke und Modell oder versuche allgemeinere Suchbegriffe.</p>
                </div>
              )}
              {comparables.map((listing) => (
                <article key={listing.id} className={excluded.has(listing.id) ? "listing excluded" : "listing"}>
                  <button
                    className="icon"
                    title={excluded.has(listing.id) ? "Wieder einbeziehen" : "Ausschließen"}
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
                  <a href={listing.url} target="_blank" rel="noreferrer" title="Quelle öffnen">
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
                Nach Prüfung befüllen
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
            <p>Der separate Kleinanzeigen-Browser nutzt ein persistentes lokales Profil. Die finale Veröffentlichung bleibt manuell.</p>
          </section>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
