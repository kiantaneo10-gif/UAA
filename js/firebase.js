import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBvCPBu7MJ_yuRUA9mNy80FB6IWE__I-mo",
  authDomain: "uniqueartsapparel-1f0d6.firebaseapp.com",
  projectId: "uniqueartsapparel-1f0d6",
  storageBucket: "uniqueartsapparel-1f0d6.firebasestorage.app",
  messagingSenderId: "25842517747",
  appId: "1:25842517747:web:3e73177e7cbe320c051986",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
