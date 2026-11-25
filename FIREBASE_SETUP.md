# Firebase setup and deployment

The storefront uses Firebase Authentication and Cloud Firestore directly from the browser. In Spark test mode, an authenticated browser writes COD orders to Firestore with `testMode: true`. This is for testing only: clients can alter order totals. The optional Callable Cloud Function re-reads product prices and validates totals for real orders, and requires the Blaze plan. The site does not require PHP, XAMPP, or Laragon.

## Firebase project

The app is configured for project `uniqueartsapparel-1f0d6`, whose existing Firestore database is in the `nam5` US multi-region.

1. In Firebase Console, enable **Authentication → Sign-in method → Email/Password**.
2. Keep the existing Cloud Firestore `(default)` database.
3. Cloud Functions and the Blaze billing plan are only needed if you later switch to secure server-side order creation.
4. The web app configuration is in [`js/firebase.js`](js/firebase.js). Its API key is a public Firebase web-app key, not a server credential. Do not put service-account keys in the website.
5. Add the Hosting domain and any custom domain to **Authentication → Settings → Authorized domains**.

## Deploy

Install Node.js 22 or later and the Firebase CLI, then run these commands from the project directory:

```powershell
npm install --global firebase-tools
firebase login
firebase use uniqueartsapparel-1f0d6
firebase deploy --only firestore:rules,hosting
```

This Spark deployment publishes [`firebase/firestore.rules`](firebase/firestore.rules) and hosts the static storefront. To deploy the secure `createOrder` function later, upgrade to Blaze and run `firebase deploy --only functions`. The app does not need a downloaded service-account JSON file.

After deployment, the site is available at the Firebase Hosting URL shown by the CLI. Add a custom domain through **Firebase Console → Hosting** if desired.

## Admin account

Register an account through the site, then find its UID under **Firebase Console → Authentication → Users**. In Firestore, edit `users/{uid}` and set `role` to `admin` while keeping `isActive` set to `true`. Admin role changes are managed in Firebase Console.

## Store data and behavior

- **`products`** are publicly readable; only active administrators can create, edit, or delete them. The six starter products are already in this project's database; their reference data is in [`firebase/products-seed.json`](firebase/products-seed.json).
- **`users`** are created at registration. Customers can read their own profile; administrators can manage customer active status and list accounts.
- **`orders`** in Spark test mode are written by signed-in users for their own accounts, with COD and pending statuses. These records are marked `testMode: true`; Firestore rules cannot verify client-calculated prices, so users can manipulate totals. Do not use this mode for real customer orders.
- The admin dashboard listens to the `orders`, `products`, and `users` collections for live updates. Admin reads and writes require an active account whose Firestore user document has `role: "admin"`; deploy `firebase/firestore.rules` for those permissions to take effect.
- For trusted order totals, deploy the `createOrder` Cloud Function on Blaze. It re-reads product prices and stock, calculates the `UAA20` discount, and writes the order.
- Checkout supports **Cash on Delivery only**. Orders start pending until an administrator updates payment and fulfillment status.
- Existing MySQL accounts and orders are not migrated. Customers must register again.
- The site uses the configured Firebase project from local development too. Be aware that local sign-in and checkout will write to the live Firebase project.

Run a local static preview without PHP or the Firebase CLI with:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

Then open `http://127.0.0.1:8080/`. This preview connects to the configured live Firebase project, so sign-ins and orders can affect live data. For production, use the Firebase Hosting deployment commands above.
