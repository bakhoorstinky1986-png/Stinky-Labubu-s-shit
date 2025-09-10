import React, { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";

type Reading = {
  date: string; // ISO datetime
  sg: string; // specific gravity as string to handle empty
  tempC: string;
  ph?: string;
};

type Alarms = {
  targetSG?: string;
  minTemp?: string;
  maxTemp?: string;
  stallHours?: string; // hours as string
};

type Batch = {
  id: string;
  name: string;
  startDate: string;
  volume: string;
  og: string;
  notes?: string;
  alarms?: Alarms;
  readings: Reading[];
};

const STORAGE_KEY = "winedruid:batches:v1";

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export default function WineDruidTracker(): JSX.Element {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [newBatch, setNewBatch] = useState<Partial<Batch>>({ name: "", startDate: "", volume: "", og: "", notes: "", alarms: {} });
  const [newReadingMap, setNewReadingMap] = useState<Record<string, Partial<Reading>>>({});
  const [globalAlarms, setGlobalAlarms] = useState<Alarms>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setBatches(JSON.parse(raw));
    } catch (e) {
      console.error("Failed to load batches", e);
    }

    try {
      if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
        Notification.requestPermission().catch(() => {});
      }
    } catch {
      // ignore environment without Notification
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
    } catch (e) {
      console.error("Failed to save batches", e);
    }
  }, [batches]);

  const notifyUser = (title: string, body: string) => {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(title, { body });
      } else {
        // fallback
        // eslint-disable-next-line no-alert
        alert(`${title}: ${body}`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Notification failed", e);
    }
  };

  const addBatch = () => {
    const batch: Batch = {
      id: uid(),
      name: newBatch.name || "Untitled",
      startDate: newBatch.startDate || new Date().toISOString().slice(0, 10),
      volume: newBatch.volume || "",
      og: newBatch.og || "",
      notes: newBatch.notes || "",
      alarms: { ...(newBatch.alarms || {}) },
      readings: [],
    };
    setBatches((s) => [...s, batch]);
    setNewBatch({ name: "", startDate: "", volume: "", og: "", notes: "", alarms: {} });
  };

  const deleteBatch = (id: string) => {
    setBatches((s) => s.filter((b) => b.id !== id));
  };

  const updateBatchAlarms = (id: string, alarms: Alarms) => {
    setBatches((s) => s.map((b) => (b.id === id ? { ...b, alarms } : b)));
  };

  const addReading = (batchId: string) => {
    const r = newReadingMap[batchId];
    if (!r || !r.date) return;
    setBatches((s) => {
      const updated = s.map((b) => {
        if (b.id !== batchId) return b;
        const readings = [...b.readings, { date: r.date as string, sg: r.sg || "", tempC: r.tempC || "", ph: r.ph }];
        const updatedBatch = { ...b, readings };
        checkAlarms(updatedBatch);
        return updatedBatch;
      });
      return updated;
    });
    setNewReadingMap((m) => ({ ...m, [batchId]: {} }));
  };

  const checkAlarms = (batch: Batch) => {
    const alarms = { ...globalAlarms, ...(batch.alarms || {}) } as Alarms;
    const readings = batch.readings;
    if (readings.length === 0) return;

    const latest = readings[readings.length - 1];
    const prev = readings.length >= 2 ? readings[readings.length - 2] : undefined;

    if (alarms.targetSG && latest.sg) {
      try {
        if (parseFloat(latest.sg) <= parseFloat(alarms.targetSG)) {
          notifyUser("🍷 WineDruid: Target SG reached", `${batch.name} reached target SG ${latest.sg}`);
        }
      } catch {}
    }

    if (alarms.minTemp && latest.tempC) {
      try {
        if (parseFloat(latest.tempC) < parseFloat(alarms.minTemp)) {
          notifyUser("🍷 WineDruid: Low Temp", `${batch.name} temperature ${latest.tempC}°C below ${alarms.minTemp}`);
        }
      } catch {}
    }

    if (alarms.maxTemp && latest.tempC) {
      try {
        if (parseFloat(latest.tempC) > parseFloat(alarms.maxTemp)) {
          notifyUser("🍷 WineDruid: High Temp", `${batch.name} temperature ${latest.tempC}°C above ${alarms.maxTemp}`);
        }
      } catch {}
    }

    if (alarms.stallHours && prev && latest.sg && prev.sg) {
      try {
        const latestSG = parseFloat(latest.sg);
        const prevSG = parseFloat(prev.sg);
        const delta = Math.abs(latestSG - prevSG);
        const latestTime = new Date(latest.date).getTime();
        const prevTime = new Date(prev.date).getTime();
        const hoursDiff = (latestTime - prevTime) / (1000 * 60 * 60);
        if (delta <= 0.002 && hoursDiff >= parseFloat(alarms.stallHours || "0")) {
          notifyUser("🍷 WineDruid: Possible Stall", `${batch.name} shows no SG change for ${alarms.stallHours}h`);
        }
      } catch {}
    }
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(batches, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `winedruid-batches-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(String(e.target?.result || "[]"));
        if (Array.isArray(parsed)) {
          setBatches(parsed.map((p) => ({ ...p, id: p.id || uid(), readings: p.readings || [] })));
        }
      } catch (err) {
        // eslint-disable-next-line no-alert
        alert("Failed to import JSON: " + String(err));
      }
    };
    reader.readAsText(file);
  };

  const exportBatchCSV = (batch: Batch) => {
    const header = ["date", "sg", "tempC", "ph"];
    const rows = batch.readings.map((r) => [r.date, r.sg, r.tempC, r.ph || ""]);
    const csv =
      [header.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}`)).join("
")].join("
");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${batch.name.replace(/\s+/g, "_") || batch.id}-readings.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">WineDruid Fermentation Tracker</h1>
        <div className="flex gap-2">
          <button className="px-3 py-1 bg-indigo-600 text-white rounded" onClick={exportJSON}>
            Export JSON
          </button>
          <label className="px-3 py-1 bg-gray-200 rounded cursor-pointer">
            Import JSON
            <input type="file" accept="application/json" onChange={(e) => importJSON(e.target.files?.[0])} className="hidden" />
          </label>
        </div>
      </header>

      <section className="bg-white p-4 rounded shadow">
        <h2 className="font-semibold">New Batch</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
          <input className="border p-2 rounded" placeholder="Name" value={newBatch.name as string} onChange={(e) => setNewBatch({ ...newBatch, name: e.target.value })} />
          <input type="date" className="border p-2 rounded" value={newBatch.startDate as string} onChange={(e) => setNewBatch({ ...newBatch, startDate: e.target.value })} />
          <input className="border p-2 rounded" placeholder="Volume (L)" value={newBatch.volume as string} onChange={(e) => setNewBatch({ ...newBatch, volume: e.target.value })} />
          <input className="border p-2 rounded" placeholder="Original Gravity" value={newBatch.og as string} onChange={(e) => setNewBatch({ ...newBatch, og: e.target.value })} />
          <input className="border p-2 rounded col-span-2" placeholder="Notes" value={newBatch.notes as string} onChange={(e) => setNewBatch({ ...newBatch, notes: e.target.value })} />
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
          <input className="border p-2 rounded" placeholder="Target SG" value={String(newBatch.alarms?.targetSG || "")} onChange={(e) => setNewBatch({ ...newBatch, alarms: { ...(newBatch.alarms || {}), targetSG: e.target.value } })} />
          <input className="border p-2 rounded" placeholder="Min Temp (°C)" value={String(newBatch.alarms?.minTemp || "")} onChange={(e) => setNewBatch({ ...newBatch, alarms: { ...(newBatch.alarms || {}), minTemp: e.target.value } })} />
          <input className="border p-2 rounded" placeholder="Max Temp (°C)" value={String(newBatch.alarms?.maxTemp || "")} onChange={(e) => setNewBatch({ ...newBatch, alarms: { ...(newBatch.alarms || {}), maxTemp: e.target.value } })} />
          <input className="border p-2 rounded" placeholder="Stall (hours)" value={String(newBatch.alarms?.stallHours || "")} onChange={(e) => setNewBatch({ ...newBatch, alarms: { ...(newBatch.alarms || {}), stallHours: e.target.value } })} />
        </div>

        <div className="mt-3 flex gap-2">
          <button className="px-3 py-1 bg-green-600 text-white rounded" onClick={addBatch}>
            Add Batch
          </button>
          <button className="px-3 py-1 bg-gray-100 rounded" onClick={() => setNewBatch({ name: "", startDate: "", volume: "", og: "", notes: "", alarms: {} })}>
            Reset
          </button>
        </div>
      </section>

      <section className="bg-white p-4 rounded shadow space-y-4">
        <h2 className="font-semibold">Batches ({batches.length})</h2>
        <div className="space-y-4">
          {batches.map((batch) => (
            <article key={batch.id} className="border rounded p-3">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-lg">{batch.name}</h3>
                  <div className="text-sm text-gray-600">Started: {batch.startDate} • Volume: {batch.volume} L • OG: {batch.og}</div>
                </div>
                <div className="flex gap-2">
                  <button className="px-2 py-1 bg-yellow-400 rounded" onClick={() => exportBatchCSV(batch)}>
                    Export CSV
                  </button>
                  <button className="px-2 py-1 bg-red-500 text-white rounded" onClick={() => deleteBatch(batch.id)}>
                    Delete
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                <input className="border p-2 rounded" placeholder="Target SG" value={String(batch.alarms?.targetSG || "")} onChange={(e) => updateBatchAlarms(batch.id, { ...(batch.alarms || {}), targetSG: e.target.value })} />
                <input className="border p-2 rounded" placeholder="Min Temp (°C)" value={String(batch.alarms?.minTemp || "")} onChange={(e) => updateBatchAlarms(batch.id, { ...(batch.alarms || {}), minTemp: e.target.value })} />
                <input className="border p-2 rounded" placeholder="Max Temp (°C)" value={String(batch.alarms?.maxTemp || "")} onChange={(e) => updateBatchAlarms(batch.id, { ...(batch.alarms || {}), maxTemp: e.target.value })} />
                <input className="border p-2 rounded" placeholder="Stall (hours)" value={String(batch.alarms?.stallHours || "")} onChange={(e) => updateBatchAlarms(batch.id, { ...(batch.alarms || {}), stallHours: e.target.value })} />
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                <input type="datetime-local" className="border p-2 rounded" value={String(newReadingMap[batch.id]?.date || "")} onChange={(e) => setNewReadingMap((m) => ({ ...m, [batch.id]: { ...(m[batch.id] || {}), date: e.target.value } }))} />
                <input className="border p-2 rounded" placeholder="Specific Gravity" value={String(newReadingMap[batch.id]?.sg || "")} onChange={(e) => setNewReadingMap((m) => ({ ...m, [batch.id]: { ...(m[batch.id] || {}), sg: e.target.value } }))} />
                <input className="border p-2 rounded" placeholder="Temp (°C)" value={String(newReadingMap[batch.id]?.tempC || "")} onChange={(e) => setNewReadingMap((m) => ({ ...m, [batch.id]: { ...(m[batch.id] || {}), tempC: e.target.value } }))} />
                <div className="flex gap-2">
                  <input className="border p-2 rounded" placeholder="pH (optional)" value={String(newReadingMap[batch.id]?.ph || "")} onChange={(e) => setNewReadingMap((m) => ({ ...m, [batch.id]: { ...(m[batch.id] || {}), ph: e.target.value } }))} />
                  <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={() => addReading(batch.id)}>
                    Add Reading
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={batch.readings} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tickFormatter={(t) => (t ? String(t).replace("T", " ") : t)} />
                    <YAxis yAxisId="left" domain={["dataMin", "dataMax"]} label={{ value: "SG", angle: -90, position: "insideLeft" }} />
                    <YAxis yAxisId="right" orientation="right" label={{ value: "Temp °C", angle: 90, position: "insideRight" }} />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="sg" stroke="#8884d8" name="SG" connectNulls />
                    <Line yAxisId="right" type="monotone" dataKey="tempC" stroke="#82ca9d" name="Temp °C" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-2 text-sm text-gray-600">Readings: {batch.readings.length}</div>
            </article>
          ))}
        </div>
      </section>

      <footer className="text-sm text-gray-500 mt-4">WineDruid — local-only tracker. You can export JSON/CSV for backups.</footer>
    </div>
  );
}