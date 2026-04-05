import { useState } from "react"
import axios from "axios"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

function Dashboard() {
  const [claims, setClaims] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [fileName, setFileName] = useState("")
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [selectedClaim, setSelectedClaim] = useState(null)
  const [investigation, setInvestigation] = useState(null)
  const [activeTab, setActiveTab] = useState("overview")

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    setLoading(true)
    const formData = new FormData()
    formData.append("file", file)
    try {
      const res = await axios.post("http://127.0.0.1:8000/upload", formData)
      setClaims(res.data.claims)
      setSummary(res.data.summary)
      setActiveTab("overview")
    } catch (err) {
      alert("Error uploading file. Make sure backend is running!")
    } finally {
      setLoading(false)
    }
  }

  const investigateClaim = (claim) => {
    setSelectedClaim(claim)
    const flags = claim.flags || []
    const excess = claim.excess || 0
    const pct = claim.approved > 0 ? Math.round((excess / claim.approved) * 100) : 0
    let note = ""
    let action = ""

    if (flags.includes("Overbill")) {
      note += `This claim is charged ₹${fmt(excess)} (${pct}%) above the PM-JAY approved rate of ₹${fmt(claim.approved)}. `
      action = "REJECT — Overbilling exceeds 30% threshold."
    }
    if (flags.includes("Phantom")) {
      note += `Inpatient procedure billed with 0 days admitted — strongly indicates phantom billing. `
      action = "REJECT — Phantom billing detected. Verify patient admission records."
    }
    if (flags.includes("Implant fraud")) {
      note += `Stent/implant charged at ${Math.round(claim.charged / claim.approved)}× the approved rate, violating NPPA price cap. `
      action = "REJECT — NPPA cap violation. Refer to drug pricing authority."
    }
    if (flags.includes("Readmission")) {
      note += `Patient readmitted within 30 days — possible premature discharge to generate additional claim. `
      action = "INVESTIGATE — Review discharge summary and readmission records."
    }
    if (flags.includes("Moderate")) {
      note += `Charged ${pct}% above approved rate. Within secondary review threshold. `
      action = "REVIEW — Request itemized bill from hospital."
    }
    if (!note) {
      note = "No significant fraud patterns detected in this claim."
      action = "APPROVE — Claim is within acceptable parameters."
    }

    setInvestigation({ note, action, flags })
  }

  const closeInvestigation = () => {
    setSelectedClaim(null)
    setInvestigation(null)
  }

  const getFraudScore = (claim) => {
    let score = 0
    if (claim.flags.includes("Overbill")) score += 40
    if (claim.flags.includes("Phantom")) score += 35
    if (claim.flags.includes("Implant fraud")) score += 35
    if (claim.flags.includes("Readmission")) score += 20
    if (claim.flags.includes("Moderate")) score += 15
    return Math.min(score, 100)
  }

  const getScoreColor = (score) => {
    if (score >= 60) return "#dc2626"
    if (score >= 30) return "#d97706"
    return "#16a34a"
  }

  const getRiskBadge = (risk) => {
    const styles = {
      high: { background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" },
      medium: { background: "#fffbeb", color: "#d97706", border: "1px solid #fde68a" },
      low: { background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" },
    }
    const s = styles[risk] || styles.low
    return (
      <span style={{ ...s, padding: "2px 10px", borderRadius: "999px", fontSize: "10px", fontWeight: "600" }}>
        {risk === "low" ? "Clear" : risk.charAt(0).toUpperCase() + risk.slice(1)}
      </span>
    )
  }

  const fmt = (n) => Math.round(n).toLocaleString("en-IN")
  const fmtCr = (n) => {
    if (n >= 10000000) return "₹" + (n / 10000000).toFixed(2) + " Cr"
    if (n >= 100000) return "₹" + (n / 100000).toFixed(2) + " L"
    return "₹" + fmt(n)
  }

  const exportPDF = () => {
    const doc = new jsPDF()

    doc.setFontSize(18)
    doc.setTextColor(15, 23, 42)
    doc.text("Ayushman Bharat - Fraud Detection Report", 14, 20)

    doc.setFontSize(10)
    doc.setTextColor(100, 116, 139)
    doc.text(`Generated on: ${new Date().toLocaleDateString("en-IN")}`, 14, 28)
    doc.text(`File: ${fileName || "Unknown"}`, 14, 34)

    doc.setFontSize(11)
    doc.setTextColor(15, 23, 42)
    doc.text("Summary", 14, 45)

    autoTable(doc, {
      startY: 50,
      head: [["Total Claims", "High Risk", "Excess Charged", "Claims Cleared"]],
      body: [[
        summary.total,
        `${summary.high_risk} (${summary.high_risk_pct}%)`,
        fmtCr(summary.total_excess),
        `${summary.cleared} (${summary.cleared_pct}%)`,
      ]],
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 10 },
      bodyStyles: { fontSize: 10 },
      margin: { left: 14, right: 14 },
    })

    const highRiskClaims = claims.filter(c => c.risk === "high")
    doc.setFontSize(11)
    doc.setTextColor(15, 23, 42)
    doc.text(`High Risk Claims (${highRiskClaims.length})`, 14, doc.lastAutoTable.finalY + 14)

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 18,
      head: [["Patient ID", "Hospital", "Procedure", "Approved (₹)", "Charged (₹)", "Excess (₹)", "Flags"]],
      body: highRiskClaims.map(c => [
        c.patient_id,
        c.hospital,
        c.procedure,
        fmt(c.approved),
        fmt(c.charged),
        `+₹${fmt(c.excess)}`,
        c.flags.join(", ") || "—",
      ]),
      headStyles: { fillColor: [220, 38, 38], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      alternateRowStyles: { fillColor: [254, 242, 242] },
      margin: { left: 14, right: 14 },
    })

    const medRiskClaims = claims.filter(c => c.risk === "medium")
    if (medRiskClaims.length > 0) {
      doc.text(`Medium Risk Claims (${medRiskClaims.length})`, 14, doc.lastAutoTable.finalY + 14)
      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 18,
        head: [["Patient ID", "Hospital", "Procedure", "Approved (₹)", "Charged (₹)", "Excess (₹)", "Flags"]],
        body: medRiskClaims.map(c => [
          c.patient_id,
          c.hospital,
          c.procedure,
          fmt(c.approved),
          fmt(c.charged),
          `+₹${fmt(c.excess)}`,
          c.flags.join(", ") || "—",
        ]),
        headStyles: { fillColor: [217, 119, 6], textColor: 255, fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        alternateRowStyles: { fillColor: [255, 251, 235] },
        margin: { left: 14, right: 14 },
      })
    }

    const pageCount = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(8)
      doc.setTextColor(150)
      doc.text(`Ayushman Bharat Fraud Detection Report · Page ${i} of ${pageCount}`, 14, doc.internal.pageSize.height - 10)
    }

    doc.save(`fraud_report_${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  const filteredClaims = claims
    .filter(c => filter === "all" ? true : c.risk === filter)
    .filter(c => {
      const q = search.toLowerCase()
      return !q || c.patient_id.toLowerCase().includes(q) ||
        c.hospital.toLowerCase().includes(q) ||
        c.procedure.toLowerCase().includes(q)
    })

  const hospitalData = Object.entries(
    claims.filter(c => c.excess > 0).reduce((acc, c) => {
      acc[c.hospital] = (acc[c.hospital] || 0) + c.excess
      return acc
    }, {})
  ).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, value]) => ({ name: name.split(" ")[0], value }))

  const riskData = [
    { name: "High", value: claims.filter(c => c.risk === "high").length, color: "#dc2626" },
    { name: "Medium", value: claims.filter(c => c.risk === "medium").length, color: "#d97706" },
    { name: "Cleared", value: claims.filter(c => c.risk === "low").length, color: "#16a34a" },
  ]

  const flagData = Object.entries(
    claims.flatMap(c => c.flags).reduce((acc, f) => {
      acc[f] = (acc[f] || 0) + 1
      return acc
    }, {})
  ).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }))

  const COLORS = ["#dc2626", "#d97706", "#2563eb", "#7c3aed", "#0891b2"]

  const styles = {
    page: { display: "flex", minHeight: "100vh", background: "#0f172a", fontFamily: "'Segoe UI', sans-serif" },
    sidebar: { width: "220px", background: "#1e293b", padding: "1.5rem 1rem", display: "flex", flexDirection: "column", gap: "4px", flexShrink: 0 },
    sidebarTitle: { color: "#f1f5f9", fontSize: "14px", fontWeight: "700", marginBottom: "1.5rem", paddingBottom: "1rem", borderBottom: "1px solid #334155" },
    navItem: (active) => ({
      padding: "8px 12px", borderRadius: "8px", cursor: "pointer", fontSize: "13px",
      background: active ? "#3b82f6" : "transparent",
      color: active ? "white" : "#94a3b8",
      border: "none", textAlign: "left", width: "100%", transition: "all 0.15s"
    }),
    main: { flex: 1, padding: "1.5rem", overflow: "auto" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" },
    headerTitle: { fontSize: "20px", fontWeight: "700", color: "#f1f5f9", margin: 0 },
    headerSub: { fontSize: "12px", color: "#64748b", marginTop: "2px" },
    card: { background: "#1e293b", borderRadius: "12px", padding: "1.2rem", border: "1px solid #334155" },
    metricGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "1.5rem" },
    metricVal: (color) => ({ fontSize: "26px", fontWeight: "700", color: color || "#f1f5f9", margin: "4px 0" }),
    metricLabel: { fontSize: "11px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" },
    metricSub: { fontSize: "11px", color: "#475569", marginTop: "2px" },
    sectionTitle: { fontSize: "13px", fontWeight: "600", color: "#f1f5f9", margin: "0 0 1rem" },
    table: { width: "100%", borderCollapse: "collapse", fontSize: "12px" },
    th: { textAlign: "left", padding: "10px 12px", fontSize: "11px", color: "#64748b", fontWeight: "500", borderBottom: "1px solid #334155", background: "#0f172a" },
    td: { padding: "10px 12px", borderBottom: "1px solid #1e293b", color: "#cbd5e1", verticalAlign: "middle" },
    filterBtn: (active) => ({
      padding: "5px 14px", borderRadius: "999px", fontSize: "11px", cursor: "pointer",
      border: "1px solid", borderColor: active ? "#3b82f6" : "#334155",
      background: active ? "#3b82f620" : "transparent",
      color: active ? "#3b82f6" : "#64748b", fontWeight: active ? "600" : "400"
    }),
    investigateBtn: { background: "#7c3aed", color: "white", border: "none", padding: "4px 12px", borderRadius: "6px", fontSize: "10px", cursor: "pointer", fontWeight: "600" },
    pill: (color) => ({ background: color + "22", color, padding: "1px 6px", borderRadius: "4px", fontSize: "9px", fontWeight: "600", marginRight: "3px", border: `1px solid ${color}33` }),
  }

  return (
    <div style={styles.page}>

      {/* Sidebar */}
      <div style={styles.sidebar}>
        <div style={styles.sidebarTitle}>🏥 AB Fraud Detection</div>
        {[
          { id: "overview", label: "📊 Overview" },
          { id: "claims", label: "📋 Claims" },
          { id: "hospitals", label: "🏨 Hospitals" },
          { id: "rules", label: "🔍 Fraud Rules" },
        ].map(item => (
          <button key={item.id} style={styles.navItem(activeTab === item.id)}
            onClick={() => setActiveTab(item.id)}>
            {item.label}
          </button>
        ))}
        <div style={{ marginTop: "auto", paddingTop: "1rem", borderTop: "1px solid #334155" }}>
          <label style={{ display: "block", background: "#3b82f6", color: "white", padding: "8px 12px", borderRadius: "8px", fontSize: "12px", cursor: "pointer", textAlign: "center", fontWeight: "600" }}>
            {loading ? "Analyzing..." : "📂 Upload CSV"}
            <input type="file" accept=".csv" onChange={handleFileUpload} style={{ display: "none" }} />
          </label>
          {fileName && <div style={{ fontSize: "10px", color: "#64748b", marginTop: "6px", textAlign: "center" }}>📄 {fileName}</div>}
        </div>
      </div>

      {/* Main */}
      <div style={styles.main}>

        {/* Header */}
        <div style={styles.header}>
          <div>
            <h1 style={styles.headerTitle}>Ayushman Bharat — Fraud Detection</h1>
            <p style={styles.headerSub}>PM-JAY Claims Intelligence Platform · {claims.length} claims loaded</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ background: "#16a34a22", color: "#16a34a", fontSize: "11px", padding: "4px 12px", borderRadius: "999px", border: "1px solid #16a34a44" }}>
              ● Live Monitoring
            </div>
            {summary && (
              <button onClick={exportPDF}
                style={{ background: "#3b82f6", color: "white", border: "none", padding: "6px 16px", borderRadius: "8px", fontSize: "12px", cursor: "pointer", fontWeight: "600" }}>
                📄 Export PDF
              </button>
            )}
          </div>
        </div>

        {/* No data */}
        {!summary && (
          <div style={{ ...styles.card, textAlign: "center", padding: "4rem 2rem", border: "2px dashed #334155" }}>
            <div style={{ fontSize: "48px", marginBottom: "1rem" }}>📂</div>
            <div style={{ fontSize: "16px", color: "#f1f5f9", fontWeight: "600", marginBottom: "8px" }}>Upload your claims CSV to begin</div>
            <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "1.5rem" }}>Supports PM-JAY standard format · Auto fraud detection · 7 detection rules</div>
            <label style={{ background: "#3b82f6", color: "white", padding: "10px 28px", borderRadius: "8px", fontSize: "13px", cursor: "pointer", fontWeight: "600" }}>
              {loading ? "Analyzing..." : "Choose CSV File"}
              <input type="file" accept=".csv" onChange={handleFileUpload} style={{ display: "none" }} />
            </label>
          </div>
        )}

        {/* Metrics */}
        {summary && (
          <div style={styles.metricGrid}>
            {[
              { label: "Total Claims", value: summary.total, sub: "uploaded records", color: "#f1f5f9" },
              { label: "High Risk", value: summary.high_risk, sub: `${summary.high_risk_pct}% of claims`, color: "#dc2626" },
              { label: "Excess Charged", value: fmtCr(summary.total_excess), sub: "vs approved rates", color: "#dc2626" },
              { label: "Claims Cleared", value: summary.cleared, sub: `${summary.cleared_pct}% clean rate`, color: "#16a34a" },
            ].map((card, i) => (
              <div key={i} style={styles.card}>
                <div style={styles.metricLabel}>{card.label}</div>
                <div style={styles.metricVal(card.color)}>{card.value}</div>
                <div style={styles.metricSub}>{card.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* OVERVIEW TAB */}
        {summary && activeTab === "overview" && (
          <>
            <div style={{ ...styles.card, marginBottom: "1.2rem" }}>
              <div style={styles.sectionTitle}>🚨 Active Fraud Signals</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {claims.filter(c => c.flags.includes("Overbill")).length > 0 && (
                  <div style={{ padding: "10px 14px", background: "#dc262610", borderRadius: "8px", borderLeft: "3px solid #dc2626", fontSize: "12px", color: "#fca5a5" }}>
                    <strong>Overbilling detected</strong> — {claims.filter(c => c.flags.includes("Overbill")).length} claims charged more than 30% above approved rate. Total excess: {fmtCr(summary.total_excess)}.
                  </div>
                )}
                {claims.filter(c => c.flags.includes("Phantom")).length > 0 && (
                  <div style={{ padding: "10px 14px", background: "#dc262610", borderRadius: "8px", borderLeft: "3px solid #dc2626", fontSize: "12px", color: "#fca5a5" }}>
                    <strong>Phantom billing</strong> — {claims.filter(c => c.flags.includes("Phantom")).length} inpatient procedures billed with 0 days admitted.
                  </div>
                )}
                {claims.filter(c => c.flags.includes("Readmission")).length > 0 && (
                  <div style={{ padding: "10px 14px", background: "#d9770610", borderRadius: "8px", borderLeft: "3px solid #d97706", fontSize: "12px", color: "#fcd34d" }}>
                    <strong>Suspicious readmissions</strong> — {claims.filter(c => c.flags.includes("Readmission")).length} patients readmitted within 30 days.
                  </div>
                )}
                {claims.filter(c => c.flags.includes("Implant fraud")).length > 0 && (
                  <div style={{ padding: "10px 14px", background: "#d9770610", borderRadius: "8px", borderLeft: "3px solid #d97706", fontSize: "12px", color: "#fcd34d" }}>
                    <strong>Implant overbilling</strong> — {claims.filter(c => c.flags.includes("Implant fraud")).length} stent/implant claims exceed 3× approved rate.
                  </div>
                )}
                <div style={{ padding: "10px 14px", background: "#16a34a10", borderRadius: "8px", borderLeft: "3px solid #16a34a", fontSize: "12px", color: "#86efac" }}>
                  <strong>{summary.cleared_pct}% claims cleared</strong> — within PM-JAY approved package rates.
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "1.2rem" }}>
              <div style={styles.card}>
                <div style={styles.sectionTitle}>Risk Distribution</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={riskData}>
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px", color: "#f1f5f9" }} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {riskData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={styles.card}>
                <div style={styles.sectionTitle}>Excess by Hospital</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={hospitalData}>
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px", color: "#f1f5f9" }} formatter={(v) => "₹" + Math.round(v).toLocaleString("en-IN")} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {hospitalData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {flagData.length > 0 && (
              <div style={styles.card}>
                <div style={styles.sectionTitle}>Fraud Rules Triggered</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
                  {flagData.map((f, i) => (
                    <div key={i} style={{ background: "#0f172a", borderRadius: "8px", padding: "12px", textAlign: "center" }}>
                      <div style={{ fontSize: "22px", fontWeight: "700", color: COLORS[i % COLORS.length] }}>{f.value}</div>
                      <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>{f.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* CLAIMS TAB */}
        {summary && activeTab === "claims" && (
          <div style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "8px" }}>
              <div style={styles.sectionTitle}>Patient Claims</div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                {["all", "high", "medium", "low"].map(f => (
                  <button key={f} style={styles.filterBtn(filter === f)} onClick={() => setFilter(f)}>
                    {f === "all" ? "All" : f === "low" ? "Cleared" : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
                <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
                  style={{ padding: "5px 10px", borderRadius: "8px", border: "1px solid #334155", background: "#0f172a", color: "#f1f5f9", fontSize: "11px", width: "160px" }} />
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {["Patient ID", "Hospital", "Procedure", "Approved", "Charged", "Excess", "Score", "Risk", "Flags", "Action"].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredClaims.map((c, i) => {
                    const score = getFraudScore(c)
                    return (
                      <tr key={i}>
                        <td style={{ ...styles.td, fontWeight: "600", color: "#f1f5f9" }}>{c.patient_id}</td>
                        <td style={styles.td}>{c.hospital}</td>
                        <td style={styles.td}>{c.procedure}</td>
                        <td style={styles.td}>₹{fmt(c.approved)}</td>
                        <td style={styles.td}>₹{fmt(c.charged)}</td>
                        <td style={{ ...styles.td, color: c.excess > 0 ? "#dc2626" : "#16a34a", fontWeight: "600" }}>
                          {c.excess > 0 ? `+₹${fmt(c.excess)}` : "—"}
                        </td>
                        <td style={styles.td}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <div style={{ width: "50px", height: "5px", background: "#334155", borderRadius: "3px" }}>
                              <div style={{ width: `${score}%`, height: "100%", background: getScoreColor(score), borderRadius: "3px" }} />
                            </div>
                            <span style={{ fontSize: "10px", color: getScoreColor(score), fontWeight: "600" }}>{score}</span>
                          </div>
                        </td>
                        <td style={styles.td}>{getRiskBadge(c.risk)}</td>
                        <td style={styles.td}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px" }}>
                            {c.flags.map((f, fi) => <span key={fi} style={styles.pill("#dc2626")}>{f}</span>)}
                            {c.flags.length === 0 && <span style={{ color: "#475569" }}>—</span>}
                          </div>
                        </td>
                        <td style={styles.td}>
                          {c.risk !== "low" && (
                            <button style={styles.investigateBtn} onClick={() => investigateClaim(c)}>
                              🔍 Investigate
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filteredClaims.length === 0 && (
                <div style={{ textAlign: "center", padding: "2rem", color: "#475569", fontSize: "13px" }}>No claims found.</div>
              )}
            </div>

            {/* Investigation Panel */}
            {selectedClaim && investigation && (
              <div style={{ marginTop: "1rem", padding: "1.2rem", background: "#0f172a", borderRadius: "10px", border: "1px solid #7c3aed44" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <h3 style={{ fontSize: "13px", fontWeight: "600", margin: 0, color: "#a78bfa" }}>
                    🤖 AI Investigation — {selectedClaim.patient_id} · {selectedClaim.hospital}
                  </h3>
                  <button onClick={closeInvestigation} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: "18px" }}>✕</button>
                </div>
                <div style={{ fontSize: "13px", color: "#cbd5e1", lineHeight: "1.7", marginBottom: "10px" }}>
                  {investigation.note}
                </div>
                <div style={{ padding: "8px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: "600", background: investigation.action.startsWith("REJECT") ? "#dc262620" : investigation.action.startsWith("APPROVE") ? "#16a34a20" : "#d9770620", color: investigation.action.startsWith("REJECT") ? "#fca5a5" : investigation.action.startsWith("APPROVE") ? "#86efac" : "#fcd34d" }}>
                  ⚖️ Recommended Action: {investigation.action}
                </div>
              </div>
            )}
          </div>
        )}

        {/* HOSPITALS TAB */}
        {summary && activeTab === "hospitals" && (
          <div style={styles.card}>
            <div style={styles.sectionTitle}>Hospital Fraud Scorecard</div>
            <table style={styles.table}>
              <thead>
                <tr>
                  {["Hospital", "Total Claims", "High Risk", "Medium Risk", "Total Excess", "Risk Score"].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(
                  claims.reduce((acc, c) => {
                    if (!acc[c.hospital]) acc[c.hospital] = { total: 0, high: 0, medium: 0, excess: 0 }
                    acc[c.hospital].total++
                    if (c.risk === "high") acc[c.hospital].high++
                    if (c.risk === "medium") acc[c.hospital].medium++
                    acc[c.hospital].excess += Math.max(0, c.excess)
                    return acc
                  }, {})
                ).sort((a, b) => b[1].high - a[1].high).map(([hosp, data], i) => {
                  const score = Math.round((data.high / data.total) * 100)
                  return (
                    <tr key={i}>
                      <td style={{ ...styles.td, fontWeight: "600", color: "#f1f5f9" }}>{hosp}</td>
                      <td style={styles.td}>{data.total}</td>
                      <td style={{ ...styles.td, color: data.high > 0 ? "#dc2626" : "#64748b", fontWeight: "600" }}>{data.high}</td>
                      <td style={{ ...styles.td, color: data.medium > 0 ? "#d97706" : "#64748b" }}>{data.medium}</td>
                      <td style={{ ...styles.td, color: data.excess > 0 ? "#dc2626" : "#64748b" }}>{fmtCr(data.excess)}</td>
                      <td style={styles.td}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ flex: 1, height: "6px", background: "#334155", borderRadius: "3px" }}>
                            <div style={{ width: `${score}%`, height: "100%", background: getScoreColor(score), borderRadius: "3px" }} />
                          </div>
                          <span style={{ fontSize: "11px", color: getScoreColor(score), fontWeight: "600", minWidth: "30px" }}>{score}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* FRAUD RULES TAB */}
        {summary && activeTab === "rules" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[
              { id: "Overbill", name: "Overbilling (>30%)", desc: "Charged more than 30% above the PM-JAY approved package rate.", color: "#dc2626" },
              { id: "Moderate", name: "Moderate excess (5–30%)", desc: "Charged 5–30% above approved rate. Requires secondary review.", color: "#d97706" },
              { id: "Phantom", name: "Phantom billing", desc: "Inpatient procedure billed with 0 days admitted.", color: "#dc2626" },
              { id: "Readmission", name: "Suspicious readmission", desc: "Patient readmitted within 30 days — possible premature discharge fraud.", color: "#d97706" },
              { id: "Implant fraud", name: "Implant/stent overbilling", desc: "Stent or implant charged >3× the approved package — NPPA cap violated.", color: "#dc2626" },
            ].map((rule, i) => {
              const count = claims.filter(c => c.flags.includes(rule.id)).length
              return (
                <div key={i} style={{ ...styles.card, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: "#f1f5f9", marginBottom: "4px" }}>{rule.name}</div>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>{rule.desc}</div>
                  </div>
                  <div style={{ textAlign: "center", minWidth: "80px" }}>
                    <div style={{ fontSize: "28px", fontWeight: "700", color: count > 0 ? rule.color : "#334155" }}>{count}</div>
                    <div style={{ fontSize: "10px", color: "#475569" }}>cases</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}

export default Dashboard