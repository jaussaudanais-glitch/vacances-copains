import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  CalendarDays, Compass, UtensilsCrossed, Wallet, Plus, Check, X,
  MapPin, Clock, ShoppingCart, ExternalLink, Sun, ChefHat, Sparkles,
  ChevronDown, Link2, Trash2, Pencil, Filter, UserPlus, ThumbsUp, CalendarPlus, AlertTriangle,
  Share2, ChevronLeft, Archive, Copy, Users, Camera, LogIn, LogOut, RotateCcw,
} from "lucide-react";
import { auth, googleProvider } from "./firebase";
import { signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from "firebase/auth";
import { db } from "./firebase";
import { collection, doc, setDoc, deleteDoc, updateDoc, onSnapshot, runTransaction } from "firebase/firestore";

/* ------------------------------------------------------------------ *
 * "Vacances des copains" — prototype à données simulées (en mémoire).
 *
 * ⚠️ Cette version simule la connexion Google, le lien partagé et la
 *    persistance. Rien n'est réellement sauvegardé ni partagé entre
 *    appareils tant que Firebase (Auth + Firestore + règles) n'est pas
 *    branché. Voir le message d'accompagnement pour l'étape suivante.
 * ------------------------------------------------------------------ */

/* ⚠️ À REMPLACER : e-mails des organisateur·rices autorisé·es à créer
   des voyages. (Tu avais mentionné une liste — colle-la ici.) */
const ADMIN_EMAILS = ["jaussaud.anais@gmail.com"];

/* Comptes Google factices pour tester le parcours de connexion. */
const MOCK_ACCOUNTS = [
  { uid: "u1", email: "anais@gmail.com", googleName: "Anaïs" },
  { uid: "u2", email: "audrey@gmail.com", googleName: "Audrey" },
  { uid: "u3", email: "leo@gmail.com", googleName: "Léo" },
  { uid: "u4", email: "camille@gmail.com", googleName: "Camille" },
  { uid: "u5", email: "sami@gmail.com", googleName: "Sami" },
  { uid: "u6", email: "nour@gmail.com", googleName: "Nour" },
  { uid: "u7", email: "theo@gmail.com", googleName: "Théo" }, // pas encore inscrit -> teste l'onboarding
];

const PALETTE = ["#E4572E", "#2FA69A", "#3B6EA5", "#C9A227", "#8E5AA8", "#D6336C", "#1E8A73", "#E8833A", "#5C6BC0", "#B0413E"];
const NOBODY = { id: "?", name: "?", color: "#B0A88F", photo: null };

const initials = (n) => String(n || "?").trim().slice(0, 2).toUpperCase();
const acctColor = (uid) => (DEMO_PEOPLE.find((p) => p.id === uid) || {}).color || "#3B6EA5";
const rid = (p) => p + Math.random().toString(36).slice(2, 9);
const newCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

/* ------- Dates / jours dérivés des dates du voyage ------- */
const WD = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const MO = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const parseISO = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const toISO = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
function buildDays(start, end) {
  const s = parseISO(start), e = parseISO(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return [];
  const out = []; const cur = new Date(s); let i = 1;
  while (cur <= e && i <= 31) { out.push({ key: "d" + i, label: WD[cur.getDay()], date: String(cur.getDate()), iso: toISO(cur) }); cur.setDate(cur.getDate() + 1); i++; }
  return out;
}
const dayLabelOf = (days, k) => { const d = days.find((x) => x.key === k); return d ? `${d.label} ${d.date}` : k; };
const fmtDateRange = (days) => {
  if (!days.length) return "";
  const a = days[0], b = days[days.length - 1];
  const ma = MO[parseISO(a.iso).getMonth()], mb = MO[parseISO(b.iso).getMonth()];
  return ma === mb ? `${a.date} → ${b.date} ${mb}` : `${a.date} ${ma} → ${b.date} ${mb}`;
};
const emptyPlanning = (days) => Object.fromEntries(days.map((d) => [d.key, []]));
const emptyMeals = (days) => Object.fromEntries(days.map((d) => [d.key, { midi: null, soir: null }]));

/* ------- Catalogues fixes ------- */
const HOURS = Array.from({ length: 16 }, (_, i) => i + 8);
const ROW_H = 42;
const UNITS = ["pièces", "sachet", "boîte", "grammes", "litre", "kg"];
const TYPES = [
  { id: "loisirs", label: "Loisirs", color: "#3B6EA5" }, { id: "culturel", label: "Culturel", color: "#8E5AA8" },
  { id: "sportif", label: "Sportif", color: "#2FA69A" }, { id: "detente", label: "Détente", color: "#C9A227" },
  { id: "gastro", label: "Gastronomie", color: "#E4572E" }, { id: "sortie", label: "Sortie", color: "#D6336C" },
];
const typeOf = (id) => TYPES.find((t) => t.id === id) || TYPES[0];
const MOMENTS = [
  { id: "matin", label: "Matin" }, { id: "aprem", label: "Après-midi" },
  { id: "soir", label: "Soir" }, { id: "any", label: "Peu importe" },
];
const momentLabel = (id) => (MOMENTS.find((m) => m.id === id) || MOMENTS[3]).label;
const PARTS = [
  { id: "matin", label: "Matin", time: "09:00", dur: 180 },
  { id: "dejeuner", label: "Déjeuner", time: "12:00", dur: 120 },
  { id: "aprem", label: "Après-midi", time: "14:00", dur: 180 },
  { id: "soir", label: "Soir", time: "19:00", dur: 120 },
];
const partOf = (id) => PARTS.find((p) => p.id === id) || PARTS[0];
const partLabel = (id) => partOf(id).label;

const num = (s) => { const v = parseFloat(String(s).replace(",", ".")); return isNaN(v) ? 0 : v; };
const fmtQty = (q) => {
  const r = Math.round(q * 100) / 100;
  const s = Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return s.replace(".", ",");
};
const ingKey = (name, unit) => `${name.trim().toLowerCase()}||${unit}`;
const useOutside = (ref, cb) => useEffect(() => {
  const h = (e) => { if (ref.current && !ref.current.contains(e.target)) cb(); };
  document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
}, []);

/* ------- Membres & voyage de démonstration ------- */
const DEMO_PEOPLE = [
  { id: "u1", email: "anais@gmail.com", name: "Anaïs", color: "#E4572E", photo: null },
  { id: "u2", email: "audrey@gmail.com", name: "Audrey", color: "#2FA69A", photo: null },
  { id: "u3", email: "leo@gmail.com", name: "Léo", color: "#3B6EA5", photo: null },
  { id: "u4", email: "camille@gmail.com", name: "Camille", color: "#C9A227", photo: null },
  { id: "u5", email: "sami@gmail.com", name: "Sami", color: "#8E5AA8", photo: null },
  { id: "u6", email: "nour@gmail.com", name: "Nour", color: "#D6336C", photo: null },
];
function makeDemoTrip() {
  const now = Date.now();
  const DAY = 86400000;
  return {
    id: "trip-demo", name: "Les vacances des copains",
    startDate: "2026-07-11", endDate: "2026-07-17",
    ownerEmail: "anais@gmail.com", inviteCode: "CASSIS26", status: "active",
    tricountUrl: "https://tricount.com/xxxxxxx",
    members: DEMO_PEOPLE.map((m) => ({ ...m })),
    planning: {
      d1: [{ id: "a1", time: "18:00", dur: 120, title: "Arrivée & apéro", place: "La maison", who: ["u1", "u2", "u3", "u4"], status: "confirmed" }],
      d2: [
        { id: "a2", time: "10:00", dur: 180, title: "Rando calanques", place: "Cassis", who: ["u1", "u3", "u5"], status: "confirmed" },
        { id: "a3", time: "21:00", dur: 120, title: "Soirée jeux", place: "La maison", who: ["u2", "u4", "u6"], status: "idea" },
      ],
      d3: [{ id: "a4", fromActivity: "ac3", fromPart: "matin", time: "09:00", dur: 180, title: "Marché de Cassis", place: "", who: ["u2", "u4", "u1", "u6"], status: "confirmed" }],
      d4: [], d5: [], d6: [], d7: [],
    },
    activities: [
      { id: "ac1", title: "Kayak dans les calanques", type: "sportif", moment: "matin", note: "", by: "u3", votes: ["u3", "u1", "u5"], slot: null, createdAt: now - 5 * DAY },
      { id: "ac2", title: "Musée Cantini", type: "culturel", moment: "aprem", note: "Expo en cours", by: "u5", votes: ["u5", "u2"], slot: null, createdAt: now - 3 * 3600000 },
      { id: "ac3", title: "Marché de Cassis", type: "sortie", moment: "matin", note: "", by: "u2", votes: ["u2", "u4", "u1", "u6"], slot: { day: "d3", part: "matin" }, createdAt: now - 4 * DAY },
      { id: "ac4", title: "Karting", type: "loisirs", moment: "any", note: "", by: "u4", votes: ["u4"], slot: null, createdAt: now - 1800000 },
    ],
    meals: {
      d1: { midi: null, soir: { id: "d1-soir", title: "Pâtes pesto", servings: 6, recipeServings: 4, recipeUrl: "", cook: "u2", ingredients: [{ id: "i1", name: "Pâtes", qty: 320, unit: "grammes" }, { id: "i2", name: "Pesto", qty: 120, unit: "grammes" }, { id: "i3", name: "Parmesan", qty: 80, unit: "grammes" }] } },
      d2: { midi: { id: "d2-midi", title: "Salade niçoise", servings: 6, recipeServings: 6, recipeUrl: "", cook: "u1", ingredients: [{ id: "i4", name: "Thon", qty: 360, unit: "grammes" }, { id: "i5", name: "Tomates", qty: 6, unit: "pièces" }, { id: "i6", name: "Oeufs", qty: 6, unit: "pièces" }] }, soir: null },
      d3: { midi: null, soir: null }, d4: { midi: null, soir: null }, d5: { midi: null, soir: null }, d6: { midi: null, soir: null }, d7: { midi: null, soir: null },
    },
    manual: [
      { id: "x1", name: "Rosé", qty: 6, unit: "pièces", done: true, assignedTo: "u4" },
      { id: "x2", name: "Café", qty: 1, unit: "sachet", done: false, assignedTo: null },
    ],
    checked: [], assignIng: {}, lastSeen: { u1: now - 2 * DAY },
  };
}

/* ------- Avatar (photo ou initiales colorées) ------- */
function Avatar({ member, size = 30, className = "" }) {
  const st = { width: size, height: size };
  if (member && member.photo) return <img className={"vc-av vc-av-img " + className} style={st} src={member.photo} alt={member.name || ""} title={member.name || ""} />;
  return <span className={"vc-av " + className} style={{ ...st, background: (member && member.color) || "#B0A88F", fontSize: Math.round(size * 0.36) }} title={member && member.name}>{initials(member && member.name)}</span>;
}

/* ================================================================== *
 *  Coquille : gère session, voyages et navigation entre les écrans.
 * ================================================================== */
export default function VacancesCopains() {
  const [screen, setScreen] = useState("login"); // login | onboarding | home | create | invite | trip
  const [session, setSession] = useState(null); // { uid, email, googleName }
const [trips, setTrips] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [pending, setPending] = useState(null); // id du voyage à rejoindre via un lien

  const isAdmin = !!session && ADMIN_EMAILS.includes(session.email);
  const me = session ? session.uid : null;
  const acct = session ? (MOCK_ACCOUNTS.find((a) => a.uid === session.uid) || { uid: session.uid, email: session.email, googleName: session.googleName || session.email }) : null;
  const activeTrip = trips.find((t) => t.id === activeId) || null;
  const isMember = (trip) => !!trip && !!session && trip.members.some((m) => m.id === session.uid);
  const canSee = (trip) => isMember(trip) || (!!session && trip.ownerEmail === session.email);
const updateTrip = (id, fn) => {
    setTrips((ts) => ts.map((t) => {
      if (t.id !== id) return t;
      const updated = fn(t);
      setDoc(doc(db, "trips", id), updated).catch((e) => console.error("Sauvegarde du voyage échouée :", e));
      return updated;
    }));
  };
  const signIn = (account) => {
    setSession({ uid: account.uid, email: account.email, googleName: account.googleName });
    if (pending) {
      const trip = trips.find((t) => t.id === pending);
      if (trip && trip.members.some((m) => m.id === account.uid)) { setActiveId(trip.id); setPending(null); setScreen("trip"); }
      else if (trip) { setActiveId(trip.id); setScreen("onboarding"); } // pending gardé jusqu'à la fin de l'onboarding
      else { setPending(null); setScreen("home"); }
    } else setScreen("home");
  };

  const signOut = () => { fbSignOut(auth); setActiveId(null); setScreen("login"); };

  // Écoute la connexion Google réelle et déclenche la navigation
  useEffect(() => {
    const stop = onAuthStateChanged(auth, (user) => {
      if (user) {
        signIn({ uid: user.uid, email: user.email, googleName: user.displayName || user.email });
      } else {
        setSession(null);
      }
    });
    return () => stop();
  }, []);
// Écoute la connexion Google réelle et déclenche la navigation
  useEffect(() => {
    const stop = onAuthStateChanged(auth, (user) => {
      if (user) {
        signIn({ uid: user.uid, email: user.email, googleName: user.displayName || user.email });
      } else {
        setSession(null);
      }
    });
    return () => stop();
  }, []);

  // Lit tous les voyages depuis Firestore, en temps réel
  useEffect(() => {
    const stop = onSnapshot(collection(db, "trips"), (snap) => {
      const list = snap.docs.map((d) => d.data());
      setTrips(list);
    }, (err) => console.error("Lecture des voyages échouée :", err));
    return () => stop();
  }, []);

  const googleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error("Échec de connexion Google :", e);
      alert("La connexion Google a échoué. Détail : " + (e && e.message ? e.message : e));
    }
  };

const createTrip = ({ name, startDate, endDate, password }) => {
      const days = buildDays(startDate, endDate);
    const owner = { id: session.uid, email: session.email, name: (acct && acct.googleName) || session.email, color: PALETTE[0], photo: null };
    const trip = {
      id: rid("trip-"), name, startDate, endDate, ownerEmail: session.email, inviteCode: newCode(), status: "active",password,
      tricountUrl: "", members: [owner], planning: emptyPlanning(days), activities: [], meals: emptyMeals(days), manual: [], checked: [], assignIng: {},
    };
    setDoc(doc(db, "trips", trip.id), trip)
      .then(() => console.log("✅ Voyage écrit dans Firestore :", trip.id))
      .catch((e) => console.error("❌ Écriture échouée :", e));
    setActiveId(trip.id);
    setScreen("onboarding"); // l'organisateur confirme aussi son profil
  };

  const completeOnboarding = (profile) => {
    const id = activeId; if (!id) return;
    const member = { id: session.uid, email: session.email, name: profile.name, color: profile.color, photo: profile.photo || null };
    updateTrip(id, (t) => ({ ...t, members: t.members.some((m) => m.id === member.id) ? t.members.map((m) => (m.id === member.id ? member : m)) : [...t.members, member] }));
    const trip = trips.find((t) => t.id === id);
    const wasPending = pending === id;
    const owner = trip && trip.ownerEmail === session.email;
    setPending(null);
    setScreen(owner && !wasPending ? "invite" : "trip");
  };
// Le mot de passe de ce voyage a-t-il déjà été validé sur cet appareil ? (ou est-on l'admin ?)
  const pwOk = (trip) => {
    if (!trip) return false;
    if (trip.ownerEmail === session?.email) return true;        // l'admin n'a jamais à le taper
    if (!trip.password) return true;                            // voyage sans mot de passe (anciens voyages)
    try { return localStorage.getItem("vc-pw-" + trip.id) === "ok"; } catch (e) { return false; }
  };
  let content;
  if (!session || screen === "login")
    content = <Login pendingTrip={pending ? trips.find((t) => t.id === pending) : null} onSignIn={signIn} onCancelPending={() => setPending(null)} onGoogle={googleLogin} />;
 else if (screen === "onboarding" && activeTrip && !pwOk(activeTrip))
    content = <TripPassword trip={activeTrip} onOk={() => setTrips((ts) => [...ts])} onCancel={() => { setScreen("home"); setPending(null); }} />;
  else if (screen === "onboarding" && activeTrip)
    content = <Onboarding trip={activeTrip} account={acct} onDone={completeOnboarding} onCancel={() => { setScreen("home"); setPending(null); }} />;
  else if (screen === "create")
    content = <CreateTrip onCreate={createTrip} onCancel={() => setScreen("home")} />;
  else if (screen === "invite" && activeTrip)
    content = <Invite trip={activeTrip} onEnter={() => setScreen("trip")} onBack={() => setScreen("home")} onSimulateFriend={() => { setPending(activeTrip.id); signOut(); }} />;
  else if (screen === "trip" && activeTrip && canSee(activeTrip))
    content = <TripApp key={activeTrip.id} trip={activeTrip} me={me} isOwner={activeTrip.ownerEmail === session.email}
      update={(fn) => updateTrip(activeTrip.id, fn)} onExit={() => { setActiveId(null); setScreen("home"); }} onShare={() => setScreen("invite")} />;
  else
    content = <Home session={session} account={acct} isAdmin={isAdmin} trips={trips} canSee={canSee}
      onOpen={(id) => { setActiveId(id); setScreen("trip"); }} onShare={(id) => { setActiveId(id); setScreen("invite"); }}
      onCreate={() => setScreen("create")} onArchive={(id) => updateTrip(id, (t) => ({ ...t, status: t.status === "archived" ? "active" : "archived" }))}
      onSignOut={signOut} />;

  return <div className="vc-root"><style>{CSS}</style><div className="vc-phone">{content}</div></div>;
}
/* ------------------------------ Login ------------------------------ */
function Login({ pendingTrip, onSignIn, onCancelPending, onGoogle }) {
  const [choose, setChoose] = useState(false);
  return (
    <div className="vc-screen vc-login vc-fade">
      <div className="vc-cover">
        <span className="vc-cover-stamp"><Sun size={13} strokeWidth={2.5} /> ENTRE POTES</span>
        <h1 className="vc-cover-title">Vacances<br />des copains</h1>
        <p className="vc-cover-sub">Le planning, les repas, les courses et les dépenses du séjour — au même endroit, pour tout le groupe.</p>
      </div>
      {pendingTrip && (
        <div className="vc-invite-banner">
          Tu as été invité·e à rejoindre « {pendingTrip.name} ». Connecte-toi pour continuer.
          <button onClick={onCancelPending}>Annuler</button>
        </div>
      )}
      <button className="vc-google-btn" onClick={onGoogle}><LogIn size={17} /> Continuer avec Google</button>
      {!choose ? (
        <button className="vc-ghostlink" onClick={() => setChoose(true)} style={{ marginTop: 12 }}>Comptes de démo (test)</button>
      ) : (
        <div className="vc-acct-list" style={{ marginTop: 12 }}>
          {MOCK_ACCOUNTS.map((a) => (
            <button key={a.uid} className="vc-acct" onClick={() => onSignIn(a)}>
              <Avatar member={{ name: a.googleName, color: acctColor(a.uid) }} size={38} />
              <span className="vc-acct-name">{a.googleName}</span>
              <span className="vc-acct-mail">{a.email}</span>
            </button>
          ))}
        </div>
      )}
      <div className="vc-sim-note">Connexion Google réelle via Firebase. Les « comptes de démo » servent uniquement aux tests.</div>
    </div>
  );
}
function TripPassword({ trip, onOk, onCancel }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const submit = () => {
    if (pw.trim() === (trip.password || "")) {
      try { localStorage.setItem("vc-pw-" + trip.id, "ok"); } catch (e) { /* ignore */ }
      onOk();
    } else {
      setError(true);
    }
  };
  return (
    <div className="vc-screen vc-ob vc-fade">
      <div className="vc-ob-head">
        <div className="vc-ob-eyebrow">Voyage protégé</div>
        <h1 className="vc-ob-trip">{trip.name}</h1>
        <div className="vc-ob-dates"><Sun size={13} /> {fmtDateRange(buildDays(trip.startDate, trip.endDate))}</div>
      </div>
      <p className="vc-screen-sub" style={{ marginTop: 8 }}>Entre le mot de passe que l'organisateur·rice t'a communiqué pour rejoindre ce voyage.</p>
      <label className="vc-lbl" style={{ marginTop: 18 }}>Mot de passe</label>
      <input className="vc-in" value={pw} autoFocus onChange={(e) => { setPw(e.target.value); setError(false); }} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Mot de passe du voyage" />
      {error && <div className="vc-create-warn">Mot de passe incorrect. Réessaie.</div>}
      <div className="vc-form-actions" style={{ marginTop: 22 }}>
        <button className="vc-btn-ghost" onClick={onCancel}>Annuler</button>
        <button className="vc-btn vc-btn-green" onClick={submit}><Check size={16} /> Valider</button>
      </div>
    </div>
  );
}
/* --------------------------- Onboarding ---------------------------- */
function Onboarding({ trip, account, onDone, onCancel }) {
  const existing = trip.members.find((m) => m.email === account.email);
  const [name, setName] = useState(existing ? existing.name : account.googleName || "");
  const usedColors = trip.members.filter((m) => m.email !== account.email).map((m) => m.color);
  const firstFree = PALETTE.find((c) => !usedColors.includes(c)) || PALETTE[0];
  const [color, setColor] = useState(existing ? existing.color : firstFree);
  const [photo, setPhoto] = useState(existing ? existing.photo : null);
  const fileRef = useRef(null);
  const onFile = (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => setPhoto(r.result); r.readAsDataURL(f); };
  const preview = { name: name || account.googleName, color, photo };
  const valid = name.trim().length > 0;
  return (
    <div className="vc-screen vc-ob vc-fade">
      <div className="vc-ob-head">
        <div className="vc-ob-eyebrow">Bienvenue sur</div>
        <h1 className="vc-ob-trip">{trip.name}</h1>
        <div className="vc-ob-dates"><Sun size={13} /> {fmtDateRange(buildDays(trip.startDate, trip.endDate))}</div>
      </div>
      <div className="vc-ob-preview"><Avatar member={preview} size={74} /><div className="vc-ob-preview-name">{preview.name || "Ton nom"}</div></div>
      <label className="vc-lbl">Ton nom ou surnom *</label>
      <input className="vc-in" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex : Nono" autoFocus />
      <label className="vc-lbl" style={{ marginTop: 16 }}>Ta couleur</label>
      <div className="vc-swatches">{PALETTE.map((c) => <button key={c} className={"vc-swatch" + (color === c ? " is-on" : "")} style={{ background: c }} onClick={() => setColor(c)}>{color === c && <Check size={15} strokeWidth={3} />}</button>)}</div>
      <label className="vc-lbl" style={{ marginTop: 16 }}>Ta photo (optionnel)</label>
      <div className="vc-photo-row">
        <button className="vc-photo-btn" onClick={() => fileRef.current && fileRef.current.click()}><Camera size={16} /> {photo ? "Changer la photo" : "Ajouter une photo"}</button>
        {photo && <button className="vc-photo-clear" onClick={() => setPhoto(null)}><X size={14} /> Retirer</button>}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFile} />
      </div>
      <div className="vc-form-actions" style={{ marginTop: 22 }}>
        <button className="vc-btn-ghost" onClick={onCancel}>Annuler</button>
        <button className="vc-btn vc-btn-green" disabled={!valid} style={{ opacity: valid ? 1 : 0.45 }} onClick={() => valid && onDone({ name: name.trim(), color, photo })}><Check size={16} /> Rejoindre le voyage</button>
      </div>
    </div>
  );
}

/* --------------------------- Créer un voyage ----------------------- */
function CreateTrip({ onCreate, onCancel }) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [password, setPassword] = useState("");
  const days = start && end ? buildDays(start, end) : [];
  const valid = name.trim() && days.length > 0 && password.trim().length >= 4;
  return (
    <div className="vc-screen vc-create vc-fade">
      <div className="vc-topbar"><button className="vc-back" onClick={onCancel}><ChevronLeft size={18} /> Retour</button></div>
      <h1 className="vc-screen-title">Nouveau voyage</h1>
      <p className="vc-screen-sub">Donne-lui un nom et cale les dates. Tu partageras le lien juste après.</p>
      <label className="vc-lbl" style={{ marginTop: 18 }}>Nom du voyage *</label>
      <input className="vc-in" placeholder="ex : Weekend à Cassis" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div className="vc-form-row" style={{ marginTop: 14 }}>
        <div style={{ flex: 1 }}><label className="vc-lbl">Début *</label><input className="vc-in" type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end && e.target.value > end) setEnd(e.target.value); }} /></div>
        <div style={{ flex: 1 }}><label className="vc-lbl">Fin *</label><input className="vc-in" type="date" min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
      </div>
      {days.length > 0 && <div className="vc-create-hint"><CalendarDays size={13} /> {days.length} jour·s · {fmtDateRange(days)}</div>}
      {start && end && days.length === 0 && <div className="vc-create-warn">La date de fin doit être après le début.</div>}
      <label className="vc-lbl" style={{ marginTop: 14 }}>Mot de passe du voyage *</label>
      <input className="vc-in" placeholder="ex : Cassis2026 (au moins 4 caractères)" value={password} onChange={(e) => setPassword(e.target.value)} />
      <div className="vc-create-hint" style={{ background: "#FBEEDB", color: "#8a6d1b" }}>
        <AlertTriangle size={13} /> Tu le partageras à tes copains. Note-le : il ne pourra plus être changé.
      </div>
      <div className="vc-form-actions" style={{ marginTop: 22 }}>
        <button className="vc-btn-ghost" onClick={onCancel}>Annuler</button>
        <button className="vc-btn vc-btn-green" disabled={!valid} style={{ opacity: valid ? 1 : 0.45 }} onClick={() => valid && onCreate({ name: name.trim(), startDate: start, endDate: end, password: password.trim() })}><Check size={16} /> Créer le voyage</button>
      </div>
    </div>
  );
}

/* ------------------------------ Invite ----------------------------- */
function Invite({ trip, onEnter, onBack, onSimulateFriend }) {
  const link = `https://vacances-copains.app/#/join/${trip.inviteCode}`;
  const [copied, setCopied] = useState(false);
  const inRef = useRef(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch (e) {
      if (inRef.current) { inRef.current.select(); try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch (e2) { /* copie manuelle */ } }
    }
  };
  const days = buildDays(trip.startDate, trip.endDate);
  return (
    <div className="vc-screen vc-invite vc-fade">
      <div className="vc-topbar"><button className="vc-back" onClick={onBack}><ChevronLeft size={18} /> Accueil</button></div>
      <div className="vc-invite-icon"><Share2 size={24} /></div>
      <h1 className="vc-screen-title">Invite tes copains</h1>
      <p className="vc-screen-sub">Envoie ce lien au groupe. En l'ouvrant, chacun se connecte et rejoint « {trip.name} ».</p>
      <div className="vc-linkbox">
        <input ref={inRef} className="vc-in vc-linkinput" readOnly value={link} onFocus={(e) => e.target.select()} />
        <button className="vc-btn vc-btn-green vc-copybtn" onClick={copy}>{copied ? <><Check size={16} /> Copié</> : <><Copy size={16} /> Copier</>}</button>
      </div>
      <div className="vc-invite-meta"><CalendarDays size={13} /> {fmtDateRange(days)} · {trip.members.length} inscrit·s</div>
      <button className="vc-btn vc-invite-enter" onClick={onEnter}>Entrer dans le voyage</button>
      <button className="vc-ghostlink" onClick={onSimulateFriend}><Users size={14} /> Simuler l'arrivée d'un copain</button>
      <div className="vc-sim-note">Dans l'app réelle, ce lien ouvrira l'écran de connexion. Ici, « simuler » te déconnecte pour tester le parcours d'arrivée d'un invité.</div>
    </div>
  );
}

/* ------------------------------- Home ------------------------------ */
function Home({ session, account, isAdmin, trips, canSee, onOpen, onShare, onCreate, onArchive, onSignOut }) {
  const mine = trips.filter(canSee);
  const active = mine.filter((t) => t.status === "active");
  const archived = mine.filter((t) => t.status === "archived");
  const owned = (t) => t.ownerEmail === session.email;
  const firstName = ((account && account.googleName) || "").split(" ")[0];
  return (
    <div className="vc-screen vc-home vc-fade">
      <div className="vc-home-top">
        <div className="vc-home-hi">
          <Avatar member={{ name: (account && account.googleName), color: acctColor(session.uid) }} size={40} />
          <div><div className="vc-home-hi-name">Salut {firstName}</div>{isAdmin && <div className="vc-home-hi-role">Organisateur·rice</div>}</div>
        </div>
        <button className="vc-icbtn" title="Se déconnecter" onClick={onSignOut}><LogOut size={16} /></button>
      </div>

      {isAdmin && <button className="vc-create-cta" onClick={onCreate}><Plus size={18} /> Créer un voyage</button>}

      <div className="vc-rayon-h" style={{ marginTop: 4 }}>Tes voyages</div>
      {active.length === 0 && <Empty text={isAdmin ? "Aucun voyage encore. Crée le premier avec le bouton ci-dessus." : "Tu n'as rejoint aucun voyage. Demande le lien à l'organisateur·rice."} />}
      {active.map((t) => {
        const days = buildDays(t.startDate, t.endDate);
        return (
          <article key={t.id} className="vc-tripcard">
            <div className="vc-tripcard-top">
              <h3 className="vc-tripcard-name">{t.name}</h3>
              {owned(t) && <span className="vc-owner-badge">Admin</span>}
            </div>
            <div className="vc-tripcard-meta"><CalendarDays size={13} /> {fmtDateRange(days)}</div>
            <div className="vc-tripcard-members">
              {t.members.slice(0, 6).map((m) => <Avatar key={m.id} member={m} size={26} />)}
              <span className="vc-count">{t.members.length ? `${t.members.length} inscrit·s` : "Aucun inscrit"}</span>
            </div>
            <div className="vc-tripcard-actions">
              <button className="vc-btn vc-btn-green vc-tc-open" onClick={() => onOpen(t.id)}>Ouvrir</button>
              {owned(t) && <button className="vc-btn-ghost" onClick={() => onShare(t.id)}><Share2 size={15} /> Partager</button>}
              {owned(t) && <button className="vc-btn-ghost" title="Archiver" onClick={() => onArchive(t.id)}><Archive size={15} /></button>}
            </div>
          </article>
        );
      })}

      {archived.length > 0 && (
        <>
          <div className="vc-rayon-h" style={{ marginTop: 20 }}>Archivés</div>
          {archived.map((t) => {
            const days = buildDays(t.startDate, t.endDate);
            return (
              <article key={t.id} className="vc-tripcard is-archived">
                <div className="vc-tripcard-top"><h3 className="vc-tripcard-name">{t.name}</h3><span className="vc-owner-badge is-arch">Archivé</span></div>
                <div className="vc-tripcard-meta"><CalendarDays size={13} /> {fmtDateRange(days)}</div>
                <div className="vc-tripcard-actions">
                  <button className="vc-btn-ghost vc-tc-open" onClick={() => onOpen(t.id)}>Ouvrir</button>
                  {owned(t) && <button className="vc-btn-ghost" onClick={() => onArchive(t.id)}><RotateCcw size={15} /> Réactiver</button>}
                </div>
              </article>
            );
          })}
        </>
      )}
    </div>
  );
}

/* ================================================================== *
 *  TripApp : l'expérience à 4 onglets, alimentée par un voyage.
 * ================================================================== */
function TripApp({ trip, me, isOwner, update, onExit, onShare }) {
  const [tab, setTab] = useState("activites");
  const days = useMemo(() => buildDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
  const members = trip.members;
  // Activités en temps réel depuis Firestore (sous-collection du voyage)
  const [fsActivities, setFsActivities] = useState([]);
  useEffect(() => {
    const ref = collection(db, "trips", trip.id, "activities");
    const stop = onSnapshot(ref, (snap) => {
      setFsActivities(snap.docs.map((d) => d.data()));
    }, (e) => console.error("Lecture activités échouée :", e));
    return () => stop();
  }, [trip.id]);
  // Courses en temps réel : cochages, "qui apporte", et articles manuels
  const [fsChecks, setFsChecks] = useState([]);
  useEffect(() => {
    const ref = collection(db, "trips", trip.id, "checks");
    const stop = onSnapshot(ref, (snap) => {
      setFsChecks(snap.docs.map((d) => ({ _id: d.id, ...d.data() })));
    }, (e) => console.error("Lecture courses échouée :", e));
    return () => stop();
  }, [trip.id]);
  // Écrit/mets à jour une activité (document séparé)
  const saveActivityFS = (act) => {
    return setDoc(doc(db, "trips", trip.id, "activities", act.id), act)
      .catch((e) => console.error("Sauvegarde activité échouée :", e));
  };
  // Supprime une activité
  const deleteActivityFS = (id) => {
    return deleteDoc(doc(db, "trips", trip.id, "activities", id))
      .catch((e) => console.error("Suppression activité échouée :", e));
  };
  // Vote sans écrasement : transaction sur l'activité seule
  const toggleVoteFS = async (id, uid) => {
    const ref = doc(db, "trips", trip.id, "activities", id);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const data = snap.data();
        const votes = data.votes || [];
        const nv = votes.includes(uid) ? votes.filter((v) => v !== uid) : [...votes, uid];
        tx.update(ref, { votes: nv });
      });
    } catch (e) { console.error("Vote échoué :", e); }
  };
  // Horodatage de la dernière visite de cette personne (pour la section "Nouveau").
  // En mémoire, réinitialisé à chaque rechargement ; persistera via Firestore plus tard.
  const [seenAt] = useState(() => (trip.lastSeen && trip.lastSeen[me]) || 0);
  useEffect(() => { update((t) => ({ ...t, lastSeen: { ...(t.lastSeen || {}), [me]: Date.now() } })); }, []);

  const apply = (v, cur) => (typeof v === "function" ? v(cur) : v);
  const setPlanning = (v) => update((t) => ({ ...t, planning: apply(v, t.planning) }));
  const setActivities = (v) => update((t) => ({ ...t, activities: apply(v, t.activities) }));
  const setMeals = (v) => update((t) => ({ ...t, meals: apply(v, t.meals) }));
 // --- Écritures Courses dans la sous-collection "checks" ---
  const checkRef = (id) => doc(db, "trips", trip.id, "checks", id);

  // Cocher/décocher un ingrédient de repas (id = clé de l'ingrédient, ex "pâtes||grammes")
  const toggleCheckedFS = (key) => {
    const existing = fsChecks.find((c) => c._id === key);
    const done = existing ? !existing.done : true;
    setDoc(checkRef(key), { manual: false, done, assignedTo: existing ? (existing.assignedTo || null) : null }, { merge: true })
      .catch((e) => console.error("Cochage échoué :", e));
  };

  // Qui apporte un ingrédient de repas
  const assignLineFS = (key, uid) => {
    setDoc(checkRef(key), { manual: false, assignedTo: uid || null }, { merge: true })
      .catch((e) => console.error("Assignation échouée :", e));
  };

  // Articles manuels : ajouter, cocher, supprimer, assigner
  const addManualFS = (item) => {
    const id = "x" + Date.now();
    setDoc(checkRef(id), { manual: true, name: item.name, qty: item.qty, unit: item.unit, done: false, assignedTo: null })
      .catch((e) => console.error("Ajout article échoué :", e));
  };
  const toggleManualFS = (id) => {
    const existing = fsChecks.find((c) => c._id === id);
    updateDoc(checkRef(id), { done: existing ? !existing.done : true })
      .catch((e) => console.error("Cochage article échoué :", e));
  };
  const removeManualFS = (id) => {
    deleteDoc(checkRef(id)).catch((e) => console.error("Suppression article échouée :", e));
  };
  const assignManualFS = (id, uid) => {
    updateDoc(checkRef(id), { assignedTo: uid || null }).catch((e) => console.error("Assignation article échouée :", e));
  };

const { planning, meals } = trip;
// Reconstruit checked / assignIng / manual à partir de la sous-collection "checks"
  const checked = fsChecks.filter((c) => !c.manual && c.done).map((c) => c._id);
  const assignIng = {};
  fsChecks.forEach((c) => { if (!c.manual && c.assignedTo) assignIng[c._id] = c.assignedTo; });
  const manual = fsChecks.filter((c) => c.manual).map((c) => ({ id: c._id, name: c.name, qty: c.qty, unit: c.unit, done: !!c.done, assignedTo: c.assignedTo || null }));
const activities = fsActivities;
  /* Pont Activités <-> Planning (partants pré-remplis avec les votes) */
  const rebuildLinked = (prev, act) => {
    let existing = null, existingDay = null;
    days.forEach((d) => (prev[d.key] || []).forEach((i) => { if (i.fromActivity === act.id) { existing = i; existingDay = d.key; } }));
    const np = {}; days.forEach((d) => (np[d.key] = (prev[d.key] || []).filter((i) => i.fromActivity !== act.id)));
    if (act.slot) {
      const base = partOf(act.slot.part);
      const same = existing && existingDay === act.slot.day && existing.fromPart === act.slot.part;
      const seededWho = (act.votes || []).filter((v) => members.some((m) => m.id === v));
      const entry = {
        id: existing ? existing.id : "a" + Date.now(), fromActivity: act.id, fromPart: act.slot.part,
        time: same ? existing.time : base.time, dur: same ? existing.dur : base.dur,
        title: act.title, place: existing ? existing.place : "", who: existing ? existing.who : seededWho, status: "confirmed",
      };
      np[act.slot.day] = [...np[act.slot.day], entry];
    }
    return np;
  };
  const saveActivity = (act) => {
    let full;
    if (act.id) { full = act; }
    else { full = { ...act, id: "ac" + Date.now(), by: me, votes: [me], createdAt: Date.now() }; }
    saveActivityFS(full);                         // écrit dans Firestore (l'affichage suit via l'écouteur)
    setPlanning((prev) => rebuildLinked(prev, full)); // planning reste en mémoire pour l'instant
  };
 const planActivity = (id, slot) => {
    const act = activities.find((a) => a.id === id); if (!act) return;
    const full = { ...act, slot };
    saveActivityFS(full);                          // le créneau de l'activité est sauvegardé
    setPlanning((prev) => rebuildLinked(prev, full)); // planning en mémoire pour l'instant
  };
  const deleteActivity = (id) => {
    deleteActivityFS(id);
    setPlanning((prev) => { const np = {}; days.forEach((d) => (np[d.key] = (prev[d.key] || []).filter((i) => i.fromActivity !== id))); return np; });
  };

  return (
    <>
      <TripHeader trip={trip} members={members} days={days} isOwner={isOwner} onExit={onExit} onShare={onShare} />
      <main className="vc-main">
        {tab === "activites" && <Activites activities={activities} setActivities={setActivities} me={me} members={members} days={days} seenAt={seenAt}
          saveActivity={saveActivity} planActivity={planActivity} deleteActivity={deleteActivity} onToggleVote={toggleVoteFS} />}
        {tab === "planning" && <Planning planning={planning} setPlanning={setPlanning} members={members} days={days} unplanActivity={(id) => planActivity(id, null)} />}
   {tab === "repas" && <Repas meals={meals} setMeals={setMeals} manual={manual} checked={checked}
          assignIng={assignIng} me={me} members={members} days={days}
          fs={{ toggleCheckedFS, assignLineFS, addManualFS, toggleManualFS, removeManualFS, assignManualFS }} />}
        {tab === "depenses" && <Depenses trip={trip} update={update} isOwner={isOwner} />}
      </main>
      <nav className="vc-tabbar">
        <TabBtn id="activites" tab={tab} setTab={setTab} icon={Compass} label="Activités" />
        <TabBtn id="planning" tab={tab} setTab={setTab} icon={CalendarDays} label="Planning" />
        <TabBtn id="repas" tab={tab} setTab={setTab} icon={UtensilsCrossed} label="Repas" />
        <TabBtn id="depenses" tab={tab} setTab={setTab} icon={Wallet} label="Dépenses" />
      </nav>
    </>
  );
}

/* ------------------------------ Header ----------------------------- */
function TripHeader({ trip, members, days, isOwner, onExit, onShare }) {
  return (
    <header className="vc-header">
      <div className="vc-th-top">
        <button className="vc-th-btn" onClick={onExit}><ChevronLeft size={16} /> Voyages</button>
        {isOwner && <button className="vc-th-btn" onClick={onShare}><Share2 size={14} /> Partager</button>}
      </div>
      <div className="vc-stamp"><Sun size={13} strokeWidth={2.5} /> {fmtDateRange(days)}</div>
      <h1 className="vc-title">{trip.name}</h1>
      <div className="vc-place"><Users size={13} /> {members.length} participant·es{isOwner && <span className="vc-th-admin">Admin</span>}</div>
      <div className="vc-avatars">{members.map((m) => <Avatar key={m.id} member={m} size={30} />)}</div>
    </header>
  );
}

/* --------------------------- Confirm delete ------------------------ */
function DeleteBtn({ onConfirm, className, children, title }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} title={title} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{children}</button>
      {open && (
        <div className="vc-modal" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
          <div className="vc-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="vc-modal-title">Ceci est ton dernier mot ?</div>
            <div className="vc-modal-actions">
              <button className="vc-btn-ghost" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>Non, j'appelle un ami</button>
              <button className="vc-btn vc-btn-danger" onClick={(e) => { e.stopPropagation(); onConfirm(); setOpen(false); }}>Oui Jean-Pierre</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ----------------------------- Activités --------------------------- */
function Activites({ activities, setActivities, me, members, days, seenAt, saveActivity, planActivity, deleteActivity,onToggleVote }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const byId = (id) => members.find((m) => m.id === id) || NOBODY;

  const toggleVote = (id) => onToggleVote(id, me);

  const save = (act) => { saveActivity(act); setEditing(null); setAdding(false); };

  if (adding || editing) return <ActivityForm initial={editing} days={days} onSave={save} onCancel={() => { setAdding(false); setEditing(null); }} />;

  const slotCount = {};
  activities.forEach((a) => { if (a.slot) { const k = a.slot.day + "|" + a.slot.part; slotCount[k] = (slotCount[k] || 0) + 1; } });
  const conflictN = (a) => (a.slot ? (slotCount[a.slot.day + "|" + a.slot.part] || 1) : 1);
  const rank = (list) => [...list].sort((a, b) => b.votes.length - a.votes.length);
  const isNew = (a) => !a.slot && !!a.createdAt && a.createdAt > seenAt && a.by !== me;
  const rankNewFirst = (list) => [...list].sort((a, b) => (isNew(b) - isNew(a)) || (b.votes.length - a.votes.length));
  const propos = rankNewFirst(activities.filter((a) => !a.slot));
  const planned = rank(activities.filter((a) => a.slot));

  const card = (a, isPlanned) => <ActCard key={a.id} a={a} me={me} byId={byId} days={days} conflict={conflictN(a)} isNew={isNew(a)}
    onVote={() => toggleVote(a.id)} onPlan={(s) => planActivity(a.id, s)} onEdit={() => setEditing(a)} onDelete={() => deleteActivity(a.id)} planned={isPlanned} />;

  return (
    <section className="vc-fade">
      <button className="vc-add" onClick={() => setAdding(true)}><Plus size={18} /> Proposer une activité</button>
      <Section title="Propositions" count={propos.length}>
        {propos.map((a) => card(a, false))}
        {propos.length === 0 && <Empty text="Aucune proposition pour le moment." />}
      </Section>
      {planned.length > 0 && (
        <Section title="Planifiées" count={planned.length}>
          {planned.map((a) => card(a, true))}
        </Section>
      )}
    </section>
  );
}

function Section({ title, count, children }) {
  return <div className="vc-actgroup"><div className="vc-rayon-h">{title} · {count}</div>{children}</div>;
}

function ActCard({ a, me, byId, days, conflict, onVote, onPlan, onEdit, onDelete, planned, isNew }) {
  const t = typeOf(a.type);
  const voted = a.votes.includes(me);
  return (
    <article className={"vc-actcard" + (isNew ? " has-new" : "")} style={{ borderLeftColor: t.color }} onClick={onEdit}>
      {isNew && <span className="vc-newbadge">New</span>}
      <h3 className="vc-actcard-title">{a.title}</h3>
      <div className="vc-actbadges">
        <span className="vc-typebadge" style={{ background: t.color }}>{t.label}</span>
        <span className="vc-mombadge">{momentLabel(a.moment)}</span>
        {planned && <span className="vc-slotbadge"><CalendarDays size={11} /> {dayLabelOf(days, a.slot.day)} · {partLabel(a.slot.part)}</span>}
        {planned && conflict > 1 && <span className="vc-conflict"><AlertTriangle size={11} /> Créneau partagé ×{conflict}</span>}
      </div>
      {a.note && <div className="vc-actnote">{a.note}</div>}
      <div className="vc-actfoot" onClick={(e) => e.stopPropagation()}>
        <div className="vc-votes">
          <button className={"vc-votebtn" + (voted ? " is-on" : "")} onClick={onVote}><ThumbsUp size={14} fill={voted ? "currentColor" : "none"} /> {a.votes.length}</button>
          <div className="vc-voters">{a.votes.slice(0, 5).map((v) => <span key={v} className="vc-av vc-av-xs" style={{ background: byId(v).color }} title={byId(v).name}>{initials(byId(v).name)}</span>)}</div>
        </div>
        <div className="vc-actright">
          <PlanPicker slot={a.slot} days={days} onPick={onPlan} planned={planned} />
          <DeleteBtn className="vc-icbtn vc-icbtn-danger" onConfirm={onDelete}><Trash2 size={14} /></DeleteBtn>
        </div>
      </div>
    </article>
  );
}

function PlanPicker({ slot, days, onPick, planned }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState((slot && slot.day) || (days[0] && days[0].key) || "d1");
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false));
  return (
    <div className="vc-plan" ref={ref}>
      <button className={"vc-planbtn" + (planned ? " is-planned" : "")} onClick={() => setOpen((o) => !o)}><CalendarPlus size={14} /> {planned ? "Modifier" : "Planifier"}</button>
      {open && (
        <div className="vc-plan-pop">
          <div className="vc-plan-lbl">Jour</div>
          <div className="vc-plan-days">
            {days.map((d) => <button key={d.key} className={"vc-plan-day" + (day === d.key ? " is-on" : "")} onClick={() => setDay(d.key)}>{d.label}<b>{d.date}</b></button>)}
          </div>
          <div className="vc-plan-lbl">Créneau</div>
          <div className="vc-plan-parts">
            {PARTS.map((p) => <button key={p.id} className="vc-plan-part" onClick={() => { onPick({ day, part: p.id }); setOpen(false); }}>{p.label}<span>{p.time}</span></button>)}
          </div>
          {planned && <button className="vc-filter-reset" onClick={() => { onPick(null); setOpen(false); }}>Retirer du planning</button>}
        </div>
      )}
    </div>
  );
}

function ActivityForm({ initial, days, onSave, onCancel }) {
  const [title, setTitle] = useState((initial && initial.title) || "");
  const [type, setType] = useState((initial && initial.type) || "loisirs");
  const [moment, setMoment] = useState((initial && initial.moment) || "any");
  const [note, setNote] = useState((initial && initial.note) || "");
  const [slotDay, setSlotDay] = useState((initial && initial.slot && initial.slot.day) || "");
  const [slotPart, setSlotPart] = useState((initial && initial.slot && initial.slot.part) || "");
  const save = () => {
    if (!title.trim()) return;
    const slot = slotDay && slotPart ? { day: slotDay, part: slotPart } : null;
    onSave({ ...(initial || {}), title: title.trim(), type, moment, note: note.trim(), slot });
  };
  return (
    <section className="vc-fade">
      <div className="vc-formhead"><div className="vc-formhead-t">{initial ? "Modifier l'activité" : "Nouvelle activité"}</div></div>
      <label className="vc-lbl">Nom *</label>
      <input className="vc-in" placeholder="ex : Kayak" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <label className="vc-lbl" style={{ marginTop: 14 }}>Type</label>
      <div className="vc-chiprow">{TYPES.map((t) => <button key={t.id} className="vc-typechip" style={type === t.id ? { background: t.color, borderColor: t.color, color: "#fff" } : { borderColor: t.color, color: t.color }} onClick={() => setType(t.id)}>{t.label}</button>)}</div>
      <label className="vc-lbl" style={{ marginTop: 14 }}>Moment privilégié</label>
      <div className="vc-chiprow">{MOMENTS.map((m) => <button key={m.id} className={"vc-tag" + (moment === m.id ? " is-on" : "")} onClick={() => setMoment(m.id)}>{m.label}</button>)}</div>
      <label className="vc-lbl" style={{ marginTop: 14 }}>Commentaire</label>
      <input className="vc-in" placeholder="Note (optionnel)" value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="vc-lbl" style={{ marginTop: 14 }}>Créneau planifié</label>
      <div className="vc-chiprow">
        <button className={"vc-tag" + (!slotDay ? " is-on" : "")} onClick={() => { setSlotDay(""); setSlotPart(""); }}>Non planifié</button>
        {days.map((d) => <button key={d.key} className={"vc-tag" + (slotDay === d.key ? " is-on" : "")} onClick={() => setSlotDay(d.key)}>{d.label} {d.date}</button>)}
      </div>
      {slotDay && <div className="vc-chiprow" style={{ marginTop: 8 }}>{PARTS.map((p) => <button key={p.id} className={"vc-tag" + (slotPart === p.id ? " is-on" : "")} onClick={() => setSlotPart(p.id)}>{p.label}</button>)}</div>}
      <div className="vc-form-actions" style={{ marginTop: 18 }}>
        <button className="vc-btn-ghost" onClick={onCancel}>Annuler</button>
        <button className="vc-btn vc-btn-green" onClick={save}><Check size={16} /> {initial ? "Valider" : "Proposer"}</button>
      </div>
    </section>
  );
}

/* ----------------------------- Planning ---------------------------- */
function Planning({ planning, setPlanning, members, days, unplanActivity }) {
  const [mode, setMode] = useState("day");
  const [day, setDay] = useState((days[0] && days[0].key) || "d1");
  const [editing, setEditing] = useState(null);

  const items = [...(planning[day] || [])].sort((a, b) => a.time.localeCompare(b.time));
  const toggleWho = (id, uid) => setPlanning((p) => ({ ...p, [day]: p[day].map((a) => (a.id === id ? { ...a, who: a.who.includes(uid) ? a.who.filter((x) => x !== uid) : [...a.who, uid] } : a)) }));
  const confirm = (id) => setPlanning((p) => ({ ...p, [day]: p[day].map((a) => (a.id === id ? { ...a, status: a.status === "idea" ? "confirmed" : "idea" } : a)) }));
  const removeItem = (a) => { if (a.fromActivity) unplanActivity(a.fromActivity); else setPlanning((p) => ({ ...p, [day]: p[day].filter((x) => x.id !== a.id) })); };
  const saveAct = (act) => { setPlanning((p) => ({ ...p, [day]: p[day].map((a) => (a.id === act.id ? act : a)) })); setEditing(null); };
  const openEvent = (dayK, act) => { setDay(dayK); setMode("day"); setEditing(act); };

  return (
    <section className="vc-fade">
      <div className="vc-seg">
        <button className={"vc-seg-btn" + (mode === "day" ? " is-on" : "")} onClick={() => setMode("day")}>Jour</button>
        <button className={"vc-seg-btn" + (mode === "week" ? " is-on" : "")} onClick={() => setMode("week")}>Semaine</button>
      </div>

      {mode === "week" ? <CalendarWeek planning={planning} days={days} onOpen={openEvent} /> : (
        <>
          <DayStrip day={day} setDay={setDay} days={days} />
          {items.length === 0 && !editing && <Empty text="Les activités planifiées depuis l'onglet Activités apparaîtront ici." />}
          <div className="vc-list">
            {items.map((a) => (editing && editing.id === a.id) ? (
              <PlanningForm key={a.id} initial={a} onSave={saveAct} onCancel={() => setEditing(null)} />
            ) : (
              <article key={a.id} className={"vc-card" + (a.status === "idea" ? " is-idea" : "")}>
                <div className="vc-card-top">
                  <span className="vc-time"><Clock size={13} /> {a.time}</span>
                  <div className="vc-card-tools">
                    <button className="vc-pill" onClick={() => confirm(a.id)}>{a.status === "idea" ? "💡 idée" : "✓ validé"}</button>
                    <button className="vc-icbtn" onClick={() => setEditing(a)}><Pencil size={14} /></button>
                    <DeleteBtn className="vc-icbtn vc-icbtn-danger" onConfirm={() => removeItem(a)}><Trash2 size={14} /></DeleteBtn>
                  </div>
                </div>
                <button className="vc-card-clik" onClick={() => setEditing(a)}>
                  <h3 className="vc-card-title">{a.title}{a.fromActivity && <span className="vc-fromact"><Compass size={11} /> activité</span>}</h3>
                  {a.place && <div className="vc-card-place"><MapPin size={12} /> {a.place}</div>}
                </button>
                <div className="vc-who">
                  {members.map((p) => { const on = a.who.includes(p.id);
                    return <button key={p.id} className={"vc-av vc-av-sm" + (on ? "" : " is-off")} style={{ background: on ? p.color : "transparent", color: on ? "#fff" : "var(--muted)", borderColor: p.color }} onClick={() => toggleWho(a.id, p.id)} title={p.name}>{initials(p.name)}</button>; })}
                  <span className="vc-count">{a.who.length} partant·es</span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function layoutDay(list) {
  const evs = list.map((a) => {
    const [hh, mm] = a.time.split(":").map(Number);
    const start = hh * 60 + (mm || 0);
    return { a, start, end: start + (a.dur || 60) };
  }).sort((x, y) => x.start - y.start || x.end - y.end);
  const out = [];
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const colsEnd = [];
    cluster.forEach((ev) => {
      let placed = -1;
      for (let c = 0; c < colsEnd.length; c++) { if (colsEnd[c] <= ev.start) { placed = c; break; } }
      if (placed < 0) { placed = colsEnd.length; colsEnd.push(ev.end); } else colsEnd[placed] = ev.end;
      ev.col = placed;
    });
    cluster.forEach((ev) => { ev.ncols = colsEnd.length; out.push(ev); });
    cluster = []; clusterEnd = -1;
  };
  evs.forEach((ev) => { if (cluster.length && ev.start >= clusterEnd) flush(); cluster.push(ev); clusterEnd = Math.max(clusterEnd, ev.end); });
  if (cluster.length) flush();
  return out;
}

function CalendarWeek({ planning, days, onOpen }) {
  const cols = { gridTemplateColumns: `26px repeat(${days.length}, 1fr)` };
  return (
    <div className="vc-cal">
      <div className="vc-cal-head" style={cols}>
        <div className="vc-cal-corner" />
        {days.map((d) => <div key={d.key} className="vc-cal-dayhead"><span>{d.label}</span><b>{d.date}</b></div>)}
      </div>
      <div className="vc-cal-body">
        <div className="vc-cal-grid" style={cols}>
          <div className="vc-cal-hours">{HOURS.map((h) => <div key={h} className="vc-cal-hour" style={{ height: ROW_H }}><span>{h}h</span></div>)}</div>
          {days.map((d) => (
            <div key={d.key} className="vc-cal-col" style={{ height: HOURS.length * ROW_H }}>
              {HOURS.map((h) => <div key={h} className="vc-cal-line" style={{ top: (h - 8) * ROW_H }} />)}
              {layoutDay(planning[d.key] || []).map(({ a, start, col, ncols }) => {
                const top = (start / 60 - 8) * ROW_H;
                const height = Math.max(((a.dur || 60) / 60) * ROW_H - 2, 22);
                const left = `calc(${(col / ncols) * 100}% + 1px)`;
                const width = `calc(${100 / ncols}% - 2px)`;
                return (
                  <button key={a.id} className={"vc-cal-event" + (a.status === "idea" ? " is-idea" : "")} style={{ top, height, left, width }} onClick={() => onOpen(d.key, a)}>
                    <span className="vc-cal-event-t">{a.time}</span><span className="vc-cal-event-n">{a.title}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlanningForm({ initial, onSave, onCancel }) {
  const [time, setTime] = useState((initial && initial.time) || "");
  const [dur, setDur] = useState((initial && initial.dur) || 60);
  const [title, setTitle] = useState((initial && initial.title) || "");
  const [place, setPlace] = useState((initial && initial.place) || "");
  const save = () => { if (!title.trim()) return; onSave({ ...(initial || {}), time: time || "12:00", dur: num(dur) || 60, title: title.trim(), place: place.trim() }); };
  return (
    <div className="vc-form">
      <div className="vc-form-row">
        <input className="vc-in vc-in-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <select className="vc-in vc-in-unit" value={dur} onChange={(e) => setDur(e.target.value)}>{[30, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60}h` : `${m}min`}</option>)}</select>
      </div>
      <input className="vc-in" placeholder="Activité" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <input className="vc-in" placeholder="Lieu (optionnel)" value={place} onChange={(e) => setPlace(e.target.value)} />
      <div className="vc-form-actions">
        <button className="vc-btn-ghost" onClick={onCancel}><X size={16} /> Annuler</button>
        <button className="vc-btn vc-btn-green" onClick={save}><Check size={16} /> {initial ? "Valider" : "Ajouter"}</button>
      </div>
    </div>
  );
}

/* --------------------------- Repas & Courses ----------------------- */
function Repas({ meals, setMeals, manual, checked, assignIng, me, members, days, fs }) {
    const [view, setView] = useState("repas");
  const [day, setDay] = useState((days[0] && days[0].key) || "d1");
  const [detail, setDetail] = useState(null);
  const [detailReturn, setDetailReturn] = useState("repas");
  const [editing, setEditing] = useState(null);
  const [cf, setCf] = useState({ selDishes: [], selPerson: null, hideBought: false });

  const scaled = (meal, ing) => ing.qty * (meal.servings / (meal.recipeServings || meal.servings));

  const shopping = useMemo(() => {
    const map = new Map();
    days.forEach((d) => ["midi", "soir"].forEach((slot) => {
      const meal = meals[d.key] && meals[d.key][slot]; if (!meal) return;
      meal.ingredients.forEach((ing) => {
        const key = ingKey(ing.name, ing.unit);
        if (!map.has(key)) map.set(key, { key, name: ing.name, unit: ing.unit, qty: 0, dishes: [] });
        const e = map.get(key); e.qty += scaled(meal, ing);
        if (!e.dishes.some((x) => x.id === meal.id)) e.dishes.push({ id: meal.id, title: meal.title });
      });
    }));
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [meals, days]);

  const allDishes = useMemo(() => {
    const out = []; days.forEach((d) => ["midi", "soir"].forEach((slot) => { const meal = meals[d.key] && meals[d.key][slot]; if (meal) out.push(meal); })); return out;
  }, [meals, days]);

  const dishDone = (meal) => meal && meal.ingredients.length > 0 && meal.ingredients.every((ing) => checked.includes(ingKey(ing.name, ing.unit)));
  const saveMeal = (d, s, meal) => setMeals((m) => ({ ...m, [d]: { ...m[d], [s]: meal } }));
  const deleteMeal = (d, s) => setMeals((m) => ({ ...m, [d]: { ...m[d], [s]: null } }));
  const openDish = (dishId) => { const i = dishId.indexOf("-"); setDetail({ day: dishId.slice(0, i), slot: dishId.slice(i + 1) }); setDetailReturn("courses"); };
  const dayMarks = {}; days.forEach((d) => { dayMarks[d.key] = { midi: !!(meals[d.key] && meals[d.key].midi), soir: !!(meals[d.key] && meals[d.key].soir) }; });

  if (editing) return <MealForm day={editing.day} slot={editing.slot} days={days} me={me} defaultServings={members.length} initial={meals[editing.day] && meals[editing.day][editing.slot]} onCancel={() => setEditing(null)} onSave={(meal) => { saveMeal(editing.day, editing.slot, meal); setEditing(null); }} />;
  if (detail) {
    const meal = meals[detail.day] && meals[detail.day][detail.slot];
    if (!meal) { setDetail(null); return null; }
    return <MealDetail day={detail.day} slot={detail.slot} days={days} meal={meal} scaled={scaled} done={dishDone(meal)} onBack={() => { setView(detailReturn); setDetail(null); }} onEdit={() => setEditing(detail)} />;
  }

  return (
    <section className="vc-fade">
      <div className="vc-seg">
        <button className={"vc-seg-btn" + (view === "repas" ? " is-on" : "")} onClick={() => setView("repas")}><ChefHat size={15} /> Repas</button>
        <button className={"vc-seg-btn" + (view === "courses" ? " is-on" : "")} onClick={() => setView("courses")}><ShoppingCart size={15} /> Courses</button>
      </div>
      {view === "repas" ? (
        <>
          <DayStrip day={day} setDay={setDay} days={days} markers={dayMarks} />
          {["midi", "soir"].map((slot) => {
            const meal = meals[day] && meals[day][slot];
            const label = slot === "midi" ? "Midi" : "Soir";
            if (!meal) return (
              <button key={slot} className="vc-slot-empty" onClick={() => setEditing({ day, slot })}>
                <span className="vc-slot-tag">{label}</span><span className="vc-slot-add"><Plus size={16} /> Ajouter le {slot === "midi" ? "déjeuner" : "dîner"}</span>
              </button>
            );
            const done = dishDone(meal), hasIng = meal.ingredients.length > 0;
            return (
              <div key={slot} className="vc-mealcard" onClick={() => { setDetail({ day, slot }); setDetailReturn("repas"); }} role="button">
                <div className="vc-mealcard-head">
                  <span className="vc-slot-tag">{label}</span>
                  <div className="vc-mealcard-headright">
                    {hasIng && <span className={"vc-coursesbadge" + (done ? " is-done" : "")}>{done ? <><Check size={12} strokeWidth={3} /> Courses faites</> : <><ShoppingCart size={12} /> À faire</>}</span>}
                    <DeleteBtn className="vc-icbtn vc-icbtn-danger" onConfirm={() => deleteMeal(day, slot)}><Trash2 size={14} /></DeleteBtn>
                  </div>
                </div>
                <h3 className="vc-mealcard-title">{meal.title}</h3>
                <div className="vc-mealmeta">
                  <span>{meal.servings} couverts</span>
                  {meal.recipeUrl && <a href={meal.recipeUrl} target="_blank" rel="noreferrer" className="vc-recipe" onClick={(e) => e.stopPropagation()}><Link2 size={12} /> recette</a>}
                  <span className="vc-mealmeta-ing">{meal.ingredients.length} ingrédient·s ›</span>
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <Courses shopping={shopping} allDishes={allDishes} checked={checked} manual={manual}
          members={members} assignIng={assignIng} dishDone={dishDone} openDish={openDish} cf={cf} setCf={setCf} fs={fs} />
      )}
    </section>
  );
}

function MealDetail({ day, slot, days, meal, scaled, done, onBack, onEdit }) {
  return (
    <section className="vc-fade">
      <div className="vc-formhead"><div className="vc-formhead-t">{slot === "midi" ? "Déjeuner" : "Dîner"} · {dayLabelOf(days, day)}</div></div>
      <h2 className="vc-detail-title">{meal.title}</h2>
      <div className="vc-detail-meta">
        <span className="vc-metapill">{meal.servings} couverts</span>
        <span className="vc-metapill">recette pour {meal.recipeServings}</span>
        {meal.ingredients.length > 0 && <span className={"vc-coursesbadge" + (done ? " is-done" : "")}>{done ? <><Check size={12} strokeWidth={3} /> Courses faites</> : <><ShoppingCart size={12} /> À faire</>}</span>}
      </div>
      {meal.recipeUrl && <a href={meal.recipeUrl} target="_blank" rel="noreferrer" className="vc-recipe vc-recipe-big"><Link2 size={14} /> Voir la recette</a>}
      <div className="vc-rayon-h" style={{ marginTop: 18 }}>Ingrédients pour {meal.servings} couverts</div>
      {meal.ingredients.length === 0 ? <Empty text="Aucun ingrédient renseigné." /> : (
        <div className="vc-detail-ings">{meal.ingredients.map((ing) => <div key={ing.id} className="vc-detail-ing"><span className="vc-groc-qty">{fmtQty(scaled(meal, ing))} {ing.unit}</span><span className="vc-groc-name">{ing.name}</span></div>)}</div>
      )}
      <div className="vc-detail-actions">
        <button className="vc-btn-ghost" onClick={onEdit}><Pencil size={16} /> Modifier le repas</button>
        <button className="vc-btn vc-btn-green" onClick={onBack}><Check size={16} /> Terminé</button>
      </div>
    </section>
  );
}
function Courses({ shopping, allDishes, checked, manual, members, assignIng, dishDone, openDish, cf, setCf, fs }) {
    const { selDishes, selPerson, hideBought } = cf;
  const byId = (id) => members.find((m) => m.id === id) || NOBODY;
  const setSelDishes = (fn) => setCf((c) => ({ ...c, selDishes: typeof fn === "function" ? fn(c.selDishes) : fn }));
  const setSelPerson = (v) => setCf((c) => ({ ...c, selPerson: v }));
  const setHideBought = (v) => setCf((c) => ({ ...c, hideBought: v }));
  const [openFilter, setOpenFilter] = useState(false);
  const [draft, setDraft] = useState({ name: "", qty: "", unit: "pièces" });
  const fref = useRef(null);
  useOutside(fref, () => setOpenFilter(false));

  const toggleLine = (key) => fs.toggleCheckedFS(key);
  const toggleManual = (id) => fs.toggleManualFS(id);
  const removeManual = (id) => fs.removeManualFS(id);
  const assignLine = (key, uid) => fs.assignLineFS(key, uid);
  const assignManual = (id, uid) => fs.assignManualFS(id, uid);
  const addManual = () => { if (!draft.name.trim()) return; fs.addManualFS({ name: draft.name.trim(), qty: num(draft.qty) || 1, unit: draft.unit }); setDraft({ name: "", qty: "", unit: "pièces" }); };

  const dishOptions = allDishes.filter((d) => !(hideBought && dishDone(d)));
  const dishFilter = selDishes.length > 0;
  const matchPerson = (assignee) => (selPerson == null ? true : (selPerson === "none" ? !assignee : assignee === selPerson));
  let lines = dishFilter ? shopping.filter((l) => l.dishes.some((d) => selDishes.includes(d.id))) : shopping;
  lines = lines.filter((l) => matchPerson(assignIng[l.key] || null));
  const manualShown = dishFilter ? [] : manual.filter((g) => matchPerson(g.assignedTo || null));
  const toBuy = lines.filter((l) => !checked.includes(l.key)).length + manualShown.filter((g) => !g.done).length;

  return (
    <div className="vc-fade">
      <div className="vc-pfilter-wrap">
        <span className="vc-pfilter-lbl">Qui fait quoi</span>
        <div className="vc-pfilter">
          {members.map((p) => <button key={p.id} className={"vc-pchip" + (selPerson === p.id ? " is-on" : "")} style={{ background: p.color }} onClick={() => setSelPerson(selPerson === p.id ? null : p.id)} title={p.name}>{initials(p.name)}</button>)}
          <button className={"vc-pchip vc-pchip-none" + (selPerson === "none" ? " is-on" : "")} onClick={() => setSelPerson(selPerson === "none" ? null : "none")} title="Non assigné">?</button>
        </div>
      </div>
      <div className="vc-filter" ref={fref}>
        <button className={"vc-filter-btn" + (dishFilter ? " is-active" : "")} onClick={() => setOpenFilter((o) => !o)}><Filter size={14} />{dishFilter ? `${selDishes.length} plat·s` : "Filtrer par plat"}<ChevronDown size={15} className={openFilter ? "vc-rot" : ""} /></button>
        {openFilter && (
          <div className="vc-filter-pop">
            <label className="vc-switch"><input type="checkbox" checked={hideBought} onChange={(e) => setHideBought(e.target.checked)} /><span>Masquer les plats déjà achetés</span></label>
            <div className="vc-filter-list">
              {dishOptions.length === 0 && <div className="vc-filter-empty">Aucun plat.</div>}
              {dishOptions.map((d) => { const on = selDishes.includes(d.id), bought = dishDone(d);
                return <button key={d.id} className={"vc-filter-item" + (on ? " is-on" : "")} onClick={() => setSelDishes((s) => (on ? s.filter((x) => x !== d.id) : [...s, d.id]))}><span className="vc-fcheck">{on && <Check size={12} strokeWidth={3} />}</span><span className="vc-fname">{d.title}</span>{bought && <span className="vc-fdone">✓</span>}</button>; })}
            </div>
            {dishFilter && <button className="vc-filter-reset" onClick={() => setSelDishes([])}>Tout afficher</button>}
          </div>
        )}
      </div>
      <div className="vc-courses-count">{toBuy} article·s à acheter{selPerson && selPerson !== "none" ? ` · ${byId(selPerson).name}` : ""}</div>
      <div className="vc-rayon-h">{dishFilter ? "Ingrédients des plats sélectionnés" : "Ingrédients des repas"}</div>
      {lines.length === 0 && <Empty text="Rien ici." />}
      {lines.map((l) => { const on = checked.includes(l.key);
        return (
          <div key={l.key} className={"vc-groc" + (on ? " is-done" : "")}>
            <div className="vc-groc-row">
              <button className="vc-groc-main" onClick={() => toggleLine(l.key)}><span className="vc-check">{on && <Check size={14} strokeWidth={3} />}</span><span className="vc-groc-qty">{fmtQty(l.qty)} {l.unit}</span><span className="vc-groc-name">{l.name}</span></button>
              <AssignPicker value={assignIng[l.key] || null} members={members} onChange={(uid) => assignLine(l.key, uid)} />
            </div>
            <div className="vc-groc-tags">{l.dishes.map((d) => <button key={d.id} className="vc-dishtag" onClick={() => openDish(d.id)}>{d.title} ›</button>)}</div>
          </div>
        );
      })}
      {!dishFilter && (
        <>
          <div className="vc-rayon-h" style={{ marginTop: 18 }}>Articles ajoutés</div>
          {manualShown.map((g) => (
            <div key={g.id} className={"vc-groc" + (g.done ? " is-done" : "")}>
              <div className="vc-groc-row">
                <button className="vc-groc-main" onClick={() => toggleManual(g.id)}><span className="vc-check">{g.done && <Check size={14} strokeWidth={3} />}</span><span className="vc-groc-qty">{fmtQty(g.qty)} {g.unit}</span><span className="vc-groc-name">{g.name}</span></button>
                <AssignPicker value={g.assignedTo || null} members={members} onChange={(uid) => assignManual(g.id, uid)} />
                <DeleteBtn className="vc-x" onConfirm={() => removeManual(g.id)}><X size={15} /></DeleteBtn>
              </div>
            </div>
          ))}
          <div className="vc-additem">
            <input className="vc-in" placeholder="Article" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addManual()} />
            <input className="vc-in vc-in-qty" placeholder="Qté" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addManual()} />
            <select className="vc-in vc-in-unit" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
            <button className="vc-btn vc-btn-sq" onClick={addManual}><Plus size={18} /></button>
          </div>
        </>
      )}
    </div>
  );
}

function AssignPicker({ value, members, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false));
  const p = value ? (members.find((m) => m.id === value) || NOBODY) : null;
  return (
    <div className="vc-assign" ref={ref}>
      <button className={"vc-assign-btn" + (p ? " has" : "")} style={p ? { background: p.color, borderColor: p.color, color: "#fff" } : {}} onClick={() => setOpen((o) => !o)}>{p ? initials(p.name) : <UserPlus size={14} />}</button>
      {open && (
        <div className="vc-assign-pop">
          {members.map((x) => <button key={x.id} className="vc-assign-opt" onClick={() => { onChange(x.id); setOpen(false); }}><span className="vc-av vc-av-xs" style={{ background: x.color }}>{initials(x.name)}</span>{x.name}</button>)}
          <button className="vc-assign-opt vc-assign-clear" onClick={() => { onChange(null); setOpen(false); }}><span className="vc-assign-x"><X size={13} /></span>Personne</button>
        </div>
      )}
    </div>
  );
}

function MealForm({ day, slot, days, me, defaultServings, initial, onCancel, onSave }) {
  const base = defaultServings || 1;
  const [title, setTitle] = useState((initial && initial.title) || "");
  const [servings, setServings] = useState((initial && initial.servings) || base);
  const [recipeServings, setRecipeServings] = useState((initial && initial.recipeServings) || (initial && initial.servings) || base);
  const [recipeUrl, setRecipeUrl] = useState((initial && initial.recipeUrl) || "");
  const [rows, setRows] = useState((initial && initial.ingredients && initial.ingredients.map((i) => ({ id: i.id, name: i.name, qty: String(i.qty), unit: i.unit }))) || [{ id: "n" + Date.now(), name: "", qty: "", unit: "grammes" }]);
  const setRow = (id, patch) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const addRow = () => setRows((r) => [...r, { id: "n" + Date.now() + Math.random(), name: "", qty: "", unit: "grammes" }]);
  const delRow = (id) => setRows((r) => r.filter((x) => x.id !== id));
  const valid = title.trim() && num(servings) > 0 && num(recipeServings) > 0;
  const save = () => { if (!valid) return; const ingredients = rows.filter((r) => r.name.trim() && num(r.qty) > 0).map((r) => ({ id: r.id, name: r.name.trim(), qty: num(r.qty), unit: r.unit })); onSave({ id: `${day}-${slot}`, title: title.trim(), servings: num(servings), recipeServings: num(recipeServings), recipeUrl: recipeUrl.trim(), cook: (initial && initial.cook) || me, ingredients }); };
  return (
    <section className="vc-fade">
      <div className="vc-formhead"><div className="vc-formhead-t">{slot === "midi" ? "Déjeuner" : "Dîner"} · {dayLabelOf(days, day)}</div></div>
      <label className="vc-lbl">Nom du plat *</label>
      <input className="vc-in" placeholder="ex : Paella" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <div className="vc-form-row" style={{ marginTop: 12 }}>
        <div style={{ flex: "0 0 120px" }}><label className="vc-lbl">Couverts prévus *</label><input className="vc-in" type="number" min="1" value={servings} onChange={(e) => setServings(e.target.value)} /></div>
        <div style={{ flex: 1 }}><label className="vc-lbl">Lien recette</label><input className="vc-in" placeholder="https:// (optionnel)" value={recipeUrl} onChange={(e) => setRecipeUrl(e.target.value)} /></div>
      </div>
      <div className="vc-recipebase"><span>Les quantités ci-dessous sont pour</span><input className="vc-in vc-in-mini" type="number" min="1" value={recipeServings} onChange={(e) => setRecipeServings(e.target.value)} /><span>personnes</span></div>
      {num(servings) !== num(recipeServings) && num(recipeServings) > 0 && <div className="vc-recipehint"><Sparkles size={12} /> Recalculé ×{fmtQty(num(servings) / num(recipeServings))} pour {num(servings) || "?"} couverts</div>}
      <div className="vc-ingrows">
        {rows.map((r) => (
          <div key={r.id} className="vc-ingrow">
            <input className="vc-in" placeholder="Ingrédient" value={r.name} onChange={(e) => setRow(r.id, { name: e.target.value })} />
            <input className="vc-in vc-in-qty" placeholder="Qté" value={r.qty} onChange={(e) => setRow(r.id, { qty: e.target.value })} />
            <select className="vc-in vc-in-unit" value={r.unit} onChange={(e) => setRow(r.id, { unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
            <button className="vc-x" onClick={() => delRow(r.id)}><X size={15} /></button>
          </div>
        ))}
      </div>
      <button className="vc-add vc-add-sm" onClick={addRow}><Plus size={16} /> Ajouter un ingrédient</button>
      <div className="vc-form-actions" style={{ marginTop: 18 }}>
        <button className="vc-btn-ghost" onClick={onCancel}>Annuler</button>
        <button className="vc-btn vc-btn-green" disabled={!valid} style={{ opacity: valid ? 1 : 0.45 }} onClick={save}><Check size={16} /> Enregistrer</button>
      </div>
    </section>
  );
}

function Depenses({ trip, update, isOwner }) {
  const [edit, setEdit] = useState(!trip.tricountUrl);
  const [url, setUrl] = useState(trip.tricountUrl || "");
  const save = () => { update((t) => ({ ...t, tricountUrl: url.trim() })); setEdit(false); };
  const has = !!trip.tricountUrl && !edit;
  return (
    <section className="vc-fade vc-dep">
      <div className="vc-dep-card">
        <div className="vc-dep-icon"><Wallet size={26} /></div>
        <h2 className="vc-dep-title">Le pot commun</h2>
        <p className="vc-dep-text">Les dépenses vivent dans le Tricount du groupe. Chacun ajoute ce qu'il paie, Tricount calcule qui doit combien.</p>
        {has ? (
          <>
            <a className="vc-dep-btn" href={trip.tricountUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Ouvrir le Tricount</a>
            {isOwner && <button className="vc-ghostlink" onClick={() => setEdit(true)} style={{ marginTop: 14 }}>Modifier le lien</button>}
            <div className="vc-dep-hint"><Sparkles size={13} /> Ajoute ta dépense le soir même, tant que tu t'en souviens.</div>
          </>
        ) : isOwner ? (
          <div className="vc-dep-edit">
            <input className="vc-in" placeholder="Colle le lien du Tricount du groupe" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="vc-btn vc-btn-green" disabled={!url.trim()} style={{ opacity: url.trim() ? 1 : 0.45 }} onClick={save}><Check size={16} /> Enregistrer le lien</button>
          </div>
        ) : (
          <div className="vc-dep-hint">L'organisateur·rice n'a pas encore ajouté le lien du Tricount.</div>
        )}
      </div>
    </section>
  );
}

function DayStrip({ day, setDay, days, markers }) {
  return (
    <div className="vc-daystrip">{days.map((d) => {
      const m = markers && markers[d.key];
      return (
        <button key={d.key} className={"vc-daychip" + (d.key === day ? " is-on" : "")} onClick={() => setDay(d.key)}>
          <span className="vc-dow">{d.label}</span><span className="vc-dnum">{d.date}</span>
          {markers && <span className="vc-marks"><i className={"vc-mark vc-mark-midi" + (m && m.midi ? " is-on" : "")} /><i className={"vc-mark vc-mark-soir" + (m && m.soir ? " is-on" : "")} /></span>}
        </button>
      );
    })}</div>
  );
}
function TabBtn({ id, tab, setTab, icon: Icon, label }) {
  const on = tab === id;
  return <button className={"vc-tab" + (on ? " is-on" : "")} onClick={() => setTab(id)}><Icon size={20} strokeWidth={on ? 2.4 : 1.9} /><span>{label}</span></button>;
}
function Empty({ text }) { return <div className="vc-empty">{text}</div>; }

/* ------------------------------- CSS ------------------------------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');
.vc-root{--paper:#FAF4E8;--ink:#22304A;--muted:#8C8471;--line:#EADFC8;--sun:#FFC531;--sea:#2FA69A;--card:#FFFCF5;--red:#C0492E;--shadow:0 2px 0 rgba(34,48,74,.05),0 8px 24px -12px rgba(34,48,74,.25);font-family:'Inter',system-ui,sans-serif;color:var(--ink);display:flex;justify-content:center;padding:20px 12px;background:radial-gradient(120% 60% at 50% -10%,#FFF4D6 0%,transparent 60%),var(--paper);min-height:100%;}
.vc-root *{box-sizing:border-box;}
.vc-phone{width:100%;max-width:400px;background:var(--paper);border:1px solid var(--line);border-radius:26px;overflow:hidden;box-shadow:var(--shadow);display:flex;flex-direction:column;min-height:790px;position:relative;}
.vc-header{padding:16px 20px 18px;background:linear-gradient(180deg,#FFE7A8 0%,var(--paper) 100%);border-bottom:1px solid var(--line);}
.vc-stamp{display:inline-flex;align-items:center;gap:5px;font-weight:700;font-size:11px;letter-spacing:.14em;color:#B8860B;border:1.5px solid #E7C56A;border-radius:6px;padding:3px 8px;transform:rotate(-2deg);background:#FFF6DC;}
.vc-title{font-family:'Fraunces',serif;font-weight:600;font-size:30px;line-height:1.04;margin:12px 0 6px;letter-spacing:-.01em;}
.vc-place{display:flex;align-items:center;gap:5px;font-size:13px;color:var(--muted);font-weight:500;}
.vc-avatars{display:flex;margin-top:14px;}
.vc-av{width:30px;height:30px;border-radius:50%;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid var(--paper);margin-left:-8px;flex:0 0 auto;overflow:hidden;}
.vc-avatars .vc-av:first-child{margin-left:0;}
.vc-av-img{object-fit:cover;}
.vc-av-xs{width:20px;height:20px;font-size:9px;margin-left:0;border-width:1.5px;}
.vc-main{flex:1;overflow-y:auto;padding:16px 16px 92px;}
.vc-fade{animation:vcfade .28s ease;}
@keyframes vcfade{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}
.vc-daystrip{display:flex;gap:7px;overflow-x:auto;padding-bottom:4px;margin-bottom:14px;scrollbar-width:none;}
.vc-daystrip::-webkit-scrollbar{display:none;}
.vc-daychip{flex:0 0 auto;border:1px solid var(--line);background:var(--card);border-radius:13px;padding:8px 11px;text-align:center;cursor:pointer;display:flex;flex-direction:column;gap:1px;min-width:46px;transition:.15s;}
.vc-daychip .vc-dow{font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;}
.vc-daychip .vc-dnum{font-family:'Fraunces',serif;font-size:17px;font-weight:600;}
.vc-daychip.is-on{background:var(--ink);border-color:var(--ink);}
.vc-daychip.is-on .vc-dow{color:#FFE7A8;}
.vc-daychip.is-on .vc-dnum{color:#fff;}
.vc-marks{display:flex;gap:4px;justify-content:center;margin-top:4px;height:6px;}
.vc-mark{width:6px;height:6px;border-radius:50%;background:transparent;border:1px solid var(--line);}
.vc-mark.is-on.vc-mark-midi{background:var(--sun);border-color:var(--sun);}
.vc-mark.is-on.vc-mark-soir{background:var(--sea);border-color:var(--sea);}
.vc-daychip.is-on .vc-mark{border-color:rgba(255,255,255,.35);}
.vc-list{display:flex;flex-direction:column;gap:11px;margin-bottom:14px;}
.vc-card{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--sea);border-radius:14px;padding:13px 14px;box-shadow:var(--shadow);}
.vc-card.is-idea{border-left-color:var(--sun);border-left-style:dashed;opacity:.96;}
.vc-card-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:6px;}
.vc-card-tools{display:flex;align-items:center;gap:5px;}
.vc-card-clik{display:block;width:100%;text-align:left;border:none;background:transparent;padding:0;cursor:pointer;font-family:inherit;}
.vc-fromact{display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:600;color:var(--sea);background:#E4F5EE;padding:2px 7px;border-radius:20px;margin-left:8px;vertical-align:middle;}
.vc-time{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--sea);}
.vc-card.is-idea .vc-time{color:#C79200;}
.vc-pill{border:none;background:#F1EAD8;color:var(--ink);font-size:11px;font-weight:600;padding:4px 9px;border-radius:20px;cursor:pointer;}
.vc-icbtn{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:8px;padding:5px;cursor:pointer;display:flex;}
.vc-icbtn:hover{color:var(--ink);background:var(--paper);}
.vc-icbtn-danger:hover{color:var(--red);}
.vc-card-title{font-family:'Fraunces',serif;font-size:18px;font-weight:600;margin:2px 0 4px;}
.vc-card-place{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--muted);margin-bottom:10px;}
.vc-who{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:8px;}
.vc-av-sm{width:26px;height:26px;margin-left:0;border:1.5px solid;cursor:pointer;font-size:10px;transition:.12s;}
.vc-av-sm.is-off{opacity:.5;}
.vc-count{font-size:11px;color:var(--muted);margin-left:4px;font-weight:500;}
.vc-add{width:100%;border:1.5px dashed var(--line);background:transparent;color:var(--muted);border-radius:13px;padding:12px;font-weight:600;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;font-family:inherit;transition:.15s;margin-bottom:14px;}
.vc-add:hover{border-color:var(--sea);color:var(--sea);background:#F3FBF9;}
.vc-add-sm{padding:9px;font-size:13px;margin:8px 0 0;}
.vc-form{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:9px;box-shadow:var(--shadow);margin-bottom:14px;}
.vc-form-row{display:flex;gap:8px;}
.vc-in{border:1px solid var(--line);background:var(--paper);border-radius:10px;padding:11px 12px;font-size:14px;font-family:inherit;color:var(--ink);width:100%;min-width:0;}
.vc-in:focus{outline:2px solid var(--sea);outline-offset:-1px;border-color:transparent;}
.vc-in-time{flex:0 0 110px;}
.vc-in-qty{flex:0 0 66px;text-align:center;}
.vc-in-unit{flex:0 0 96px;padding:11px 8px;}
.vc-in-mini{width:56px;text-align:center;padding:7px 6px;flex:0 0 auto;}
.vc-form-actions{display:flex;gap:8px;justify-content:flex-end;}
.vc-btn{border:none;background:var(--ink);color:#fff;border-radius:10px;padding:10px 15px;font-weight:600;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;}
.vc-btn:disabled{cursor:not-allowed;}
.vc-btn-green{background:var(--sea);}
.vc-btn-danger{background:var(--red);}
.vc-btn-sq{padding:10px 13px;}
.vc-btn-ghost{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:10px;padding:10px 14px;font-weight:600;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;}
.vc-seg{display:flex;gap:6px;background:#F1EAD8;padding:4px;border-radius:13px;margin-bottom:14px;}
.vc-seg-btn{flex:1;border:none;background:transparent;color:var(--muted);border-radius:10px;padding:9px;font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-family:inherit;transition:.15s;}
.vc-seg-btn.is-on{background:var(--card);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.08);}
.vc-lbl{display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:5px;}
.vc-chiprow{display:flex;gap:6px;flex-wrap:wrap;}
.vc-tag{border:1px solid var(--line);background:var(--card);color:var(--muted);border-radius:20px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;}
.vc-tag.is-on{background:var(--sun);border-color:var(--sun);color:var(--ink);}
.vc-typechip{border:1.4px solid;background:var(--card);border-radius:20px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;}
/* modal confirmation */
.vc-modal{position:fixed;inset:0;z-index:100;background:rgba(34,48,74,.4);display:flex;align-items:center;justify-content:center;padding:24px;animation:vcfade .15s ease;}
.vc-modal-box{background:var(--card);border-radius:18px;padding:22px 20px;max-width:320px;width:100%;box-shadow:0 20px 50px -12px rgba(0,0,0,.4);text-align:center;}
.vc-modal-title{font-family:'Fraunces',serif;font-size:19px;font-weight:600;margin-bottom:18px;}
.vc-modal-actions{display:flex;gap:9px;}
.vc-modal-actions .vc-btn-ghost{flex:1;justify-content:center;}
.vc-modal-actions .vc-btn{flex:1;justify-content:center;}
/* activités */
.vc-actgroup{margin-top:6px;margin-bottom:6px;}
.vc-actcard{background:var(--card);border:1px solid var(--line);border-left:4px solid;border-radius:14px;padding:13px 14px;margin-bottom:9px;box-shadow:var(--shadow);cursor:pointer;transition:.15s;position:relative;}
.vc-newbadge{position:absolute;top:12px;right:12px;background:var(--sea);color:#fff;font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:3px 8px;border-radius:20px;box-shadow:0 1px 3px rgba(0,0,0,.18);}
.vc-actcard.has-new .vc-actcard-title{padding-right:46px;}
.vc-actcard:hover{border-color:var(--sea);}
.vc-actcard-title{font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin:0 0 8px;}
.vc-actbadges{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.vc-typebadge{font-size:11px;font-weight:700;color:#fff;padding:3px 9px;border-radius:20px;}
.vc-mombadge{font-size:11px;font-weight:600;color:var(--muted);background:#F1EAD8;padding:3px 9px;border-radius:20px;}
.vc-slotbadge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#1E6F8A;background:#E1F0F5;padding:3px 9px;border-radius:20px;}
.vc-conflict{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#fff;background:var(--red);padding:3px 9px;border-radius:20px;}
.vc-actnote{font-size:12.5px;color:var(--muted);margin-top:8px;}
.vc-actfoot{display:flex;align-items:center;justify-content:space-between;margin-top:11px;gap:8px;}
.vc-votes{display:flex;align-items:center;gap:8px;}
.vc-votebtn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:20px;padding:5px 11px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;}
.vc-votebtn.is-on{background:var(--sea);border-color:var(--sea);color:#fff;}
.vc-voters{display:flex;}
.vc-voters .vc-av-xs{margin-left:-6px;border:1.5px solid var(--card);}
.vc-voters .vc-av-xs:first-child{margin-left:0;}
.vc-actright{display:flex;align-items:center;gap:6px;flex:0 0 auto;}
.vc-plan{position:relative;}
.vc-planbtn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--sea);background:transparent;color:var(--sea);border-radius:9px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;}
.vc-planbtn.is-planned{border-color:var(--line);color:var(--muted);}
.vc-plan-pop{position:absolute;right:0;bottom:38px;z-index:30;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;box-shadow:0 12px 30px -8px rgba(34,48,74,.3);width:244px;}
.vc-plan-lbl{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 6px;}
.vc-plan-days{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;}
.vc-plan-day{flex:1 0 27px;border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:5px 2px;font-size:10px;font-weight:600;color:var(--muted);cursor:pointer;font-family:inherit;display:flex;flex-direction:column;line-height:1.2;}
.vc-plan-day b{font-size:12px;color:var(--ink);}
.vc-plan-day.is-on{background:var(--ink);border-color:var(--ink);color:#FFE7A8;}
.vc-plan-day.is-on b{color:#fff;}
.vc-plan-parts{display:grid;grid-template-columns:1fr 1fr;gap:5px;}
.vc-plan-part{border:1px solid var(--sea);background:transparent;color:var(--sea);border-radius:9px;padding:7px 4px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;flex-direction:column;line-height:1.2;}
.vc-plan-part span{font-size:9px;opacity:.7;font-weight:500;}
.vc-plan-part:hover{background:var(--sea);color:#fff;}
/* calendrier */
.vc-cal{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--card);box-shadow:var(--shadow);}
.vc-cal-head{display:grid;grid-template-columns:26px repeat(7,1fr);background:var(--ink);position:sticky;top:0;z-index:5;}
.vc-cal-dayhead{padding:7px 1px;text-align:center;color:#fff;border-left:1px solid rgba(255,255,255,.12);line-height:1.1;}
.vc-cal-dayhead span{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.03em;color:#FFE7A8;font-weight:600;}
.vc-cal-dayhead b{font-size:13px;font-family:'Fraunces',serif;}
.vc-cal-body{max-height:560px;overflow-y:auto;}
.vc-cal-grid{display:grid;grid-template-columns:26px repeat(7,1fr);position:relative;}
.vc-cal-hours{position:relative;}
.vc-cal-hour{position:relative;border-top:1px solid var(--line);}
.vc-cal-hour span{position:absolute;top:-7px;right:3px;font-size:9px;color:var(--muted);font-weight:600;background:var(--card);padding:0 1px;}
.vc-cal-col{position:relative;border-left:1px solid var(--line);}
.vc-cal-line{position:absolute;left:0;right:0;border-top:1px solid #F0E7D2;}
.vc-cal-event{position:absolute;background:var(--sea);color:#fff;border-radius:5px;padding:2px 3px;overflow:hidden;text-align:left;border:1px solid var(--card);cursor:pointer;font-family:inherit;display:flex;flex-direction:column;line-height:1.05;box-shadow:0 1px 2px rgba(0,0,0,.15);}
.vc-cal-event.is-idea{background:#F0C64B;color:#5c4a12;}
.vc-cal-event-t{font-size:8px;font-weight:700;opacity:.85;}
.vc-cal-event-n{font-size:9px;font-weight:600;overflow:hidden;text-overflow:ellipsis;}
/* repas */
.vc-slot-empty{width:100%;display:flex;align-items:center;gap:12px;background:transparent;border:1.5px dashed var(--line);border-radius:14px;padding:16px 14px;margin-bottom:11px;cursor:pointer;font-family:inherit;transition:.15s;}
.vc-slot-empty:hover{border-color:var(--sea);background:#F3FBF9;}
.vc-slot-tag{flex:0 0 auto;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--sea);padding:5px 9px;border-radius:7px;}
.vc-slot-add{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-weight:600;font-size:14px;}
.vc-slot-empty:hover .vc-slot-add{color:var(--sea);}
.vc-mealcard{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:11px;box-shadow:var(--shadow);cursor:pointer;transition:.15s;}
.vc-mealcard:hover{border-color:var(--sea);}
.vc-mealcard-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px;}
.vc-mealcard-headright{display:flex;align-items:center;gap:7px;}
.vc-coursesbadge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;padding:4px 9px;border-radius:20px;background:#FBEEDB;color:#C79200;}
.vc-coursesbadge.is-done{background:#E4F5EE;color:#1E8A73;}
.vc-mealcard-title{font-family:'Fraunces',serif;font-size:20px;font-weight:600;margin:0 0 7px;}
.vc-mealmeta{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--muted);flex-wrap:wrap;}
.vc-recipe{display:inline-flex;align-items:center;gap:4px;color:var(--sea);text-decoration:none;font-weight:600;}
.vc-recipe-big{font-size:14px;margin-top:12px;}
.vc-mealmeta-ing{margin-left:auto;font-weight:600;color:var(--sea);}
.vc-formhead{display:flex;align-items:center;gap:10px;margin-bottom:16px;}
.vc-formhead-t{font-family:'Fraunces',serif;font-size:18px;font-weight:600;}
.vc-detail-title{font-family:'Fraunces',serif;font-size:26px;font-weight:600;margin:0 0 12px;}
.vc-detail-meta{display:flex;gap:7px;flex-wrap:wrap;align-items:center;}
.vc-metapill{font-size:12px;font-weight:600;color:var(--ink);background:#F1EAD8;padding:4px 10px;border-radius:20px;}
.vc-detail-ings{display:flex;flex-direction:column;gap:6px;}
.vc-detail-ing{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:11px;padding:11px 12px;}
.vc-detail-actions{display:flex;gap:8px;margin-top:22px;}
.vc-detail-actions .vc-btn-ghost{flex:1;justify-content:center;}
.vc-detail-actions .vc-btn{flex:1;justify-content:center;}
.vc-recipebase{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;font-weight:500;color:var(--ink);background:#F3FBF9;border:1px solid #CDEBE4;border-radius:11px;padding:11px 12px;margin-top:16px;}
.vc-recipehint{display:flex;align-items:center;gap:5px;font-size:12px;color:#1E8A73;font-weight:600;margin:8px 0 4px;}
.vc-ingrows{display:flex;flex-direction:column;gap:7px;margin-top:12px;}
.vc-ingrow{display:flex;gap:6px;align-items:center;}
.vc-x{border:none;background:transparent;color:var(--muted);cursor:pointer;padding:4px;display:flex;flex:0 0 auto;}
.vc-x:hover{color:var(--ink);}
.vc-pfilter-wrap{margin-bottom:12px;}
.vc-pfilter-lbl{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);}
.vc-pfilter{display:flex;gap:7px;align-items:center;overflow-x:auto;padding:8px 0 2px;scrollbar-width:none;}
.vc-pfilter::-webkit-scrollbar{display:none;}
.vc-pchip{flex:0 0 auto;width:34px;height:34px;border-radius:50%;border:2.5px solid transparent;color:#fff;font-size:11px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:.5;transition:.15s;}
.vc-pchip.is-on{opacity:1;border-color:var(--ink);}
.vc-pchip-none{background:#D9D2C0!important;color:#7a7059;}
.vc-filter{position:relative;margin-bottom:12px;}
.vc-filter-btn{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:11px;padding:9px 13px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;}
.vc-filter-btn.is-active{background:var(--ink);color:#fff;border-color:var(--ink);}
.vc-rot{transform:rotate(180deg);}
.vc-filter-pop{position:absolute;top:46px;left:0;right:0;z-index:20;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;box-shadow:0 12px 30px -8px rgba(34,48,74,.3);}
.vc-switch{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:500;color:var(--ink);cursor:pointer;padding-bottom:10px;border-bottom:1px solid var(--line);margin-bottom:10px;}
.vc-switch input{width:17px;height:17px;accent-color:var(--sea);}
.vc-filter-list{display:flex;flex-direction:column;gap:3px;max-height:190px;overflow-y:auto;}
.vc-filter-item{display:flex;align-items:center;gap:9px;border:none;background:transparent;padding:8px 6px;border-radius:9px;cursor:pointer;font-family:inherit;text-align:left;width:100%;}
.vc-filter-item:hover{background:var(--paper);}
.vc-filter-item.is-on{background:#F3FBF9;}
.vc-fcheck{flex:0 0 auto;width:19px;height:19px;border-radius:6px;border:1.7px solid var(--sea);display:flex;align-items:center;justify-content:center;color:#fff;}
.vc-filter-item.is-on .vc-fcheck{background:var(--sea);}
.vc-fname{flex:1;font-size:13.5px;font-weight:500;color:var(--ink);}
.vc-fdone{font-size:12px;color:#1E8A73;font-weight:700;}
.vc-filter-empty{font-size:13px;color:var(--muted);padding:6px;font-style:italic;}
.vc-filter-reset{width:100%;margin-top:10px;border:none;background:var(--paper);color:var(--muted);border-radius:9px;padding:8px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;}
.vc-courses-count{font-size:12px;color:var(--muted);font-weight:500;margin-bottom:10px;}
.vc-rayon-h{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 8px 2px;}
.vc-groc{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:10px 12px;margin-bottom:6px;transition:.12s;}
.vc-groc-row{display:flex;align-items:center;gap:8px;}
.vc-groc-main{flex:1;display:flex;align-items:center;gap:10px;border:none;background:transparent;cursor:pointer;font-family:inherit;text-align:left;padding:0;min-width:0;}
.vc-check{flex:0 0 auto;width:21px;height:21px;border-radius:6px;border:1.8px solid var(--sea);display:flex;align-items:center;justify-content:center;color:#fff;}
.vc-groc.is-done .vc-check{background:var(--sea);}
.vc-groc-qty{flex:0 0 auto;font-size:12px;font-weight:700;color:var(--ink);background:#F1EAD8;padding:3px 7px;border-radius:6px;min-width:52px;text-align:center;}
.vc-groc-name{flex:1;font-size:14px;font-weight:500;color:var(--ink);min-width:0;}
.vc-groc.is-done .vc-groc-name{text-decoration:line-through;color:var(--muted);}
.vc-groc.is-done{opacity:.72;}
.vc-groc-tags{display:flex;gap:5px;flex-wrap:wrap;padding-left:31px;margin-top:8px;}
.vc-dishtag{font-size:10.5px;font-weight:600;color:var(--sea);background:#E4F5EE;padding:3px 8px;border-radius:20px;white-space:nowrap;border:none;cursor:pointer;font-family:inherit;}
.vc-dishtag:hover{background:#CDEBE4;}
.vc-additem{display:flex;gap:6px;margin-top:8px;}
.vc-assign{position:relative;flex:0 0 auto;}
.vc-assign-btn{width:28px;height:28px;border-radius:50%;border:1.5px dashed var(--line);background:transparent;display:flex;align-items:center;justify-content:center;color:var(--muted);cursor:pointer;padding:0;font-size:10px;font-weight:700;}
.vc-assign-btn.has{border-style:solid;}
.vc-assign-pop{position:absolute;right:0;top:34px;z-index:30;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px;box-shadow:0 12px 30px -8px rgba(34,48,74,.3);width:172px;}
.vc-assign-opt{display:flex;align-items:center;gap:9px;width:100%;border:none;background:transparent;padding:7px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;color:var(--ink);text-align:left;}
.vc-assign-opt:hover{background:var(--paper);}
.vc-assign-x{width:20px;height:20px;border-radius:50%;border:1.5px dashed var(--line);display:flex;align-items:center;justify-content:center;color:var(--muted);}
.vc-dep{display:flex;align-items:center;justify-content:center;min-height:440px;}
.vc-dep-card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:30px 24px;text-align:center;box-shadow:var(--shadow);max-width:320px;width:100%;}
.vc-dep-icon{width:58px;height:58px;border-radius:16px;background:var(--sun);color:var(--ink);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;transform:rotate(-4deg);}
.vc-dep-title{font-family:'Fraunces',serif;font-size:23px;font-weight:600;margin:0 0 9px;}
.vc-dep-text{font-size:14px;line-height:1.55;color:var(--muted);margin:0 0 20px;}
.vc-dep-btn{display:inline-flex;align-items:center;gap:8px;background:var(--ink);color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 22px;border-radius:12px;}
.vc-dep-hint{display:flex;align-items:center;gap:6px;justify-content:center;font-size:12px;color:#C79200;margin-top:18px;font-weight:500;}
.vc-dep-edit{display:flex;flex-direction:column;gap:10px;margin-top:4px;}
.vc-dep-edit .vc-btn{justify-content:center;}
.vc-empty{text-align:center;color:var(--muted);font-size:14px;padding:26px 10px;font-style:italic;}
.vc-tabbar{position:absolute;bottom:0;left:0;right:0;display:flex;background:var(--card);border-top:1px solid var(--line);padding:8px 4px calc(8px + env(safe-area-inset-bottom));}
.vc-tab{flex:1;border:none;background:transparent;color:var(--muted);display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 2px;font-size:10.5px;font-weight:600;cursor:pointer;font-family:inherit;border-radius:12px;transition:.15s;}
.vc-tab.is-on{color:var(--ink);}
.vc-tab.is-on svg{color:var(--sea);}
/* ---- écrans coquille (login / onboarding / accueil / création / invite) ---- */
.vc-acct .vc-av,.vc-home-hi .vc-av,.vc-ob-preview .vc-av{margin-left:0;}
.vc-tripcard-members .vc-av{margin-left:-7px;}
.vc-tripcard-members .vc-av:first-child{margin-left:0;}
.vc-screen{flex:1;display:flex;flex-direction:column;padding:26px 20px 30px;}
.vc-screen-title{font-family:'Fraunces',serif;font-size:26px;font-weight:600;margin:0 0 6px;letter-spacing:-.01em;}
.vc-screen-sub{font-size:14px;line-height:1.5;color:var(--muted);margin:0;}
.vc-topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;}
.vc-back{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;color:var(--muted);font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;padding:4px 2px;}
.vc-back:hover{color:var(--ink);}
.vc-ghostlink{display:inline-flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--sea);font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;margin:14px auto 0;}
.vc-sim-note{font-size:11.5px;color:var(--muted);text-align:center;margin-top:auto;padding-top:22px;line-height:1.5;font-style:italic;}
.vc-login{text-align:center;}
.vc-cover{margin:14px 0 26px;}
.vc-cover-stamp{display:inline-flex;align-items:center;gap:5px;font-weight:700;font-size:11px;letter-spacing:.14em;color:#B8860B;border:1.5px solid #E7C56A;border-radius:6px;padding:4px 9px;transform:rotate(-2deg);background:#FFF6DC;}
.vc-cover-title{font-family:'Fraunces',serif;font-weight:600;font-size:34px;line-height:1.03;margin:16px 0 10px;letter-spacing:-.01em;}
.vc-cover-sub{font-size:14px;color:var(--muted);line-height:1.5;max-width:280px;margin:0 auto;}
.vc-google-btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;background:var(--ink);color:#fff;border:none;border-radius:12px;padding:14px 18px;font-weight:600;font-size:15px;cursor:pointer;font-family:inherit;width:100%;}
.vc-acct-list{display:flex;flex-direction:column;gap:8px;}
.vc-acct{display:flex;align-items:center;gap:12px;border:1px solid var(--line);background:var(--card);border-radius:13px;padding:11px 13px;cursor:pointer;font-family:inherit;text-align:left;box-shadow:var(--shadow);}
.vc-acct:hover{border-color:var(--sea);}
.vc-acct-name{font-weight:600;font-size:14px;color:var(--ink);}
.vc-acct-mail{font-size:12px;color:var(--muted);margin-left:auto;}
.vc-invite-banner{background:#FFF6DC;border:1px solid #E7C56A;border-radius:12px;padding:11px 13px;font-size:13px;color:#7a5c0b;line-height:1.45;margin-bottom:18px;text-align:left;}
.vc-invite-banner button{border:none;background:transparent;color:#B8860B;font-weight:700;cursor:pointer;font-family:inherit;text-decoration:underline;padding:0;margin-left:4px;}
.vc-ob-head{text-align:center;margin-bottom:8px;}
.vc-ob-eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);}
.vc-ob-trip{font-family:'Fraunces',serif;font-size:26px;font-weight:600;margin:4px 0 6px;}
.vc-ob-dates{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#B8860B;}
.vc-ob-preview{display:flex;flex-direction:column;align-items:center;gap:8px;margin:18px 0 20px;}
.vc-ob-preview-name{font-family:'Fraunces',serif;font-size:17px;font-weight:600;}
.vc-swatches{display:flex;gap:9px;flex-wrap:wrap;}
.vc-swatch{width:34px;height:34px;border-radius:50%;border:2.5px solid transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.12);}
.vc-swatch.is-on{border-color:var(--ink);}
.vc-photo-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.vc-photo-btn{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:11px;padding:10px 13px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;}
.vc-photo-btn:hover{border-color:var(--sea);color:var(--sea);}
.vc-photo-clear{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;color:var(--muted);font-weight:600;font-size:12px;cursor:pointer;font-family:inherit;}
.vc-create-hint{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:#1E8A73;font-weight:600;background:#E4F5EE;border-radius:9px;padding:8px 11px;margin-top:14px;align-self:flex-start;}
.vc-create-warn{font-size:12.5px;color:var(--red);font-weight:600;margin-top:12px;}
.vc-invite{text-align:center;}
.vc-invite-icon{width:56px;height:56px;border-radius:16px;background:var(--sun);color:var(--ink);display:flex;align-items:center;justify-content:center;margin:6px auto 16px;transform:rotate(-4deg);}
.vc-linkbox{display:flex;gap:8px;margin:18px 0 12px;}
.vc-linkinput{flex:1;font-size:13px;color:var(--muted);}
.vc-copybtn{flex:0 0 auto;white-space:nowrap;}
.vc-invite-meta{font-size:12.5px;color:var(--muted);font-weight:500;margin-bottom:20px;}
.vc-invite-enter{width:100%;justify-content:center;padding:13px;font-size:15px;}
.vc-home-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;}
.vc-home-hi{display:flex;align-items:center;gap:11px;}
.vc-home-hi-name{font-family:'Fraunces',serif;font-size:20px;font-weight:600;line-height:1.1;}
.vc-home-hi-role{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--sea);}
.vc-create-cta{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:var(--ink);color:#fff;border:none;border-radius:13px;padding:14px;font-weight:600;font-size:15px;cursor:pointer;font-family:inherit;margin-bottom:20px;}
.vc-tripcard{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:15px 16px;margin-bottom:11px;box-shadow:var(--shadow);}
.vc-tripcard.is-archived{opacity:.72;}
.vc-tripcard-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;}
.vc-tripcard-name{font-family:'Fraunces',serif;font-size:19px;font-weight:600;margin:0;}
.vc-owner-badge{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#fff;background:var(--sea);padding:3px 8px;border-radius:20px;flex:0 0 auto;}
.vc-owner-badge.is-arch{background:var(--muted);}
.vc-tripcard-meta{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);font-weight:500;margin-bottom:11px;}
.vc-tripcard-members{display:flex;align-items:center;gap:2px;margin-bottom:13px;min-height:26px;}
.vc-tripcard-members .vc-count{margin-left:9px;}
.vc-tripcard-actions{display:flex;gap:8px;align-items:center;}
.vc-tc-open{flex:1;justify-content:center;}
.vc-th-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
.vc-th-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(34,48,74,.14);background:rgba(255,255,255,.5);color:var(--ink);border-radius:9px;padding:6px 10px;font-weight:600;font-size:12px;cursor:pointer;font-family:inherit;}
.vc-th-btn:hover{background:#fff;}
.vc-th-admin{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#fff;background:var(--sea);padding:2px 7px;border-radius:20px;margin-left:8px;vertical-align:middle;}
@media (prefers-reduced-motion:reduce){.vc-fade{animation:none;}}
`;
