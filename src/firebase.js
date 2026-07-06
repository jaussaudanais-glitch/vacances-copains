import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDPISTwej5uCwawgPHclUmFyhLz19Ruqxc",
  authDomain: "vacances-copains.firebaseapp.com",
  projectId: "vacances-copains",
  storageBucket: "vacances-copains.firebasestorage.app",
  messagingSenderId: "58189084431",
  appId: "1:58189084431:web:777d7c8ef0cb414f5e307a",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);