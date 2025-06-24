// Firebase Setup
const firebaseConfig = {
    apiKey: "AIzaSyArz5yG76B6PVSAgCB2Gm-q0HIL4dtyuSA",
    authDomain: "buy-or-sell-842be.firebaseapp.com",
    projectId: "buy-or-sell-842be",
    storageBucket: "buy-or-sell-842be.firebasestorage.app",
    messagingSenderId: "100212436192",
    appId: "1:100212436192:web:0023aacf40cd14e894f485"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const SIGHTENGINE_USER = "1736130229";
const SIGHTENGINE_SECRET = "M7qVcdrixcrPKoCEMfSoBmE5hVvEhRUs";


const imgbbAPIKey = "fbf49c46cab4d00ac86122db48644c0d";

let postsPerPage = window.innerWidth >= 768 ? 21 : 10;

let lastVisibleDoc = null;
let isLoadingMore = false;

window.addEventListener("resize", () => {
    postsPerPage = window.innerWidth >= 768 ? 9 : 6;
});


let selectedFiles = [];
let filterCat = "All",
    filterSearch = "";
let currentThread = null;
let marketCache = [];
let unsubscribeChatListener = null;
let chatRecipientId = null;


if (!localStorage.getItem("userId")) {
    localStorage.setItem("userId", crypto.randomUUID());
}

async function ensureProfileComplete() {
    const userId = localStorage.getItem("userId");
    const doc = await db.collection("users").doc(userId).get();
    const user = doc.data() || {};
    const name = user.name?.trim();
    const phone = user.phone?.trim();

    const isValid = name && phone && /^[0-9]{7,15}$/.test(phone);

    if (!isValid) {
        const proceed = confirm("⚠️ Your profile is incomplete.\n\nYou need to complete your profile before sending messages.\n\nClick OK to go to your profile.");
        if (proceed) {
            showSection("profile");
        }
        return false;
    }

    return true;
}

function getThreadId(userA, userB, productId) {
    const sorted = [userA, userB].sort();
    return `${sorted[0]}_${sorted[1]}_${productId}`;
}

function getThreadId(buyerId, sellerId, productId) {
    const ids = [buyerId, sellerId].sort(); // ensures consistent order
    return `${ids[0]}_${ids[1]}_${productId}`;
}

document.addEventListener("DOMContentLoaded", () => {
    // ✅ Ensure userId exists
    if (!localStorage.getItem("userId")) {
        const newId = crypto.randomUUID();
        localStorage.setItem("userId", newId);
        console.log("🔐 Created new userId:", newId);
    }

    const userId = localStorage.getItem("userId");

    // ✅ Create blank user profile if missing
    db.collection("users").doc(userId).get().then(doc => {
        if (!doc.exists) {
            db.collection("users").doc(userId).set({
                name: "",
                phone: ""
            }).then(() => {
                console.log("🆕 Created blank user profile.");
            }).catch(err => {
                console.error("⚠️ Failed to create blank profile:", err);
            });
        } else {
            console.log("✅ User profile already exists.");
        }
    });

    // ✅ Initialize app features
    initNav();
    initProductForm();
    initFilters();
    setupMessageBadge();
    setupPrivateInboxWatcher();
    // 👋 Set welcome message
    setWelcomeMessage();

    // ✅ Toggle mobile filter dropdown
    const filterToggleBtn = document.getElementById("filterToggleBtn");
    const filterDropdown = document.getElementById("filterDropdown");

    if (filterToggleBtn && filterDropdown) {
        filterToggleBtn.addEventListener("click", () => {
            filterDropdown.classList.toggle("hidden");

            // ✅ Scroll to top on mobile when filters are shown
            const isMobile = window.innerWidth <= 768;
            const nowVisible = !filterDropdown.classList.contains("hidden");

            if (isMobile && nowVisible) {
                window.scrollTo({
                    top: 0,
                    behavior: "smooth"
                });
            }
        });


        // ✅ Optional: auto-close dropdown on mobile after selecting a filter
        const dropdownSelects = filterDropdown.querySelectorAll("select");
        dropdownSelects.forEach(select => {
            select.addEventListener("change", () => {
                if (window.innerWidth < 768) {
                    filterDropdown.classList.add("hidden");
                }
            });
        });
    }


    // ✅ Safe: Load More button
    const loadMoreBtn = document.getElementById("loadMoreBtn");
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener("click", () => {
            if (!isLoadingMore) renderMarket(false);
        });
    }

    // ✅ Safe: Toggle desktop menu dropdown
    const menuBtn = document.getElementById("menuBtn");
    const dropdown = document.querySelector(".menuDropdown");
    if (menuBtn && dropdown) {
        menuBtn.addEventListener("click", () => {
            dropdown.classList.toggle("hidden");
        });
    }

    // ✅ Show default view
    showSection("market");
});

// Navigation
function initNav() {
    const buttons = document.querySelectorAll("button[data-nav]");

    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            const section = btn.dataset.nav;
            showSection(section);

            // Optional: add .active class
            document.querySelectorAll("button[data-nav]").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
        });
    });
}

function showSection(id) {
    // 🔹 1. Hide all sections
    document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));

    // 🔹 2. Show selected section
    const selected = document.getElementById(id);
    if (selected) selected.classList.add("active");

    // ✅ 3. Highlight active nav button (desktop or mobile)
    document.querySelectorAll("button[data-nav]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.nav === id);
    });

    // 🔹 4. Load section-specific content
    if (id === "market") renderMarket();
    if (id === "myposts") renderMyPosts();

    if (id === "messages") {
        renderPrivateInbox();

        // ✅ Mark all unread messages as seen
        const userId = localStorage.getItem("userId");
        db.collection("messages")
            .where("type", "==", "private")
            .where("toUserId", "==", userId)
            .get()
            .then(snapshot => {
                snapshot.forEach(doc => {
                    const msg = doc.data();
                    if (!msg.seenBy || !msg.seenBy.includes(userId)) {
                        doc.ref.update({
                            seenBy: firebase.firestore.FieldValue.arrayUnion(userId)
                        });
                    }
                });
            });

        // ✅ Reset message badge
        const badge = document.querySelector(".nav-messages-btn .msg-badge");
        if (badge) {
            badge.textContent = "";
            badge.classList.add("hidden");
        }
    }

    if (id === "profile") loadProfileFields();
}

// Message Badge
let unreadCount = 0;

function setupMessageBadge() {
    const userId = localStorage.getItem("userId");
    const badge = document.querySelector(".nav-messages-btn .msg-badge");

    db.collection("messages").onSnapshot(snapshot => {
        let unread = 0;

        snapshot.forEach(doc => {
            const msg = doc.data();
            if (
                msg.type === "private" &&
                msg.toUserId === userId &&
                (!msg.seenBy || !msg.seenBy.includes(userId))
            ) {
                unread++;
            }
        });

        if (badge) {
            badge.textContent = unread;
            badge.classList.toggle("hidden", unread === 0);
        }
    });
}


// Filters
function initFilters() {
    const typeSelect = document.getElementById("filterType");
    const orderSelect = document.getElementById("filterOrder");
    const minPriceInput = document.getElementById("minPrice");
    const maxPriceInput = document.getElementById("maxPrice");
    const conditionSelect = document.getElementById("filterCondition");

    const applyFilters = () => {
        const selectedType = typeSelect.value;
        const selectedOrder = orderSelect.value;
        const minPrice = parseFloat(minPriceInput.value) || 0;
        const maxPrice = parseFloat(maxPriceInput.value) || Infinity;
        const selectedCondition = conditionSelect.value;

        const filtered = marketCache.filter(product => {
            const matchesType = !selectedType || product.category.includes(selectedType);
            const matchesPrice = product.price >= minPrice && product.price <= maxPrice;
            const matchesCondition = !selectedCondition || product.condition === selectedCondition;

            return matchesType && matchesPrice && matchesCondition;
        });

        // Sort results
        if (selectedOrder === "price_low_high") {
            filtered.sort((a, b) => a.price - b.price);
        } else if (selectedOrder === "price_high_low") {
            filtered.sort((a, b) => b.price - a.price);
        } else {
            filtered.sort((a, b) => b.timestamp - a.timestamp); // default: latest
        }

        displayProducts(filtered);
    };

    // Attach listeners for instant filtering
    [typeSelect, orderSelect, minPriceInput, maxPriceInput, conditionSelect].forEach(el => {
        el.addEventListener("change", applyFilters);
    });
}

function debounce(fn, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}

// Profile
function loadProfileFields() {
    const userId = localStorage.getItem("userId");

    db.collection("users").doc(userId).get().then(doc => {
        const user = doc.data() || {};
        document.getElementById("editName").value = user.name || "";
        document.getElementById("editPhone").value = user.phone || "";
    });
}

document.getElementById("profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const submitBtn = e.target.querySelector("button[type='submit']");
    disableTemporarily(submitBtn); // ✅ Add here
    submitBtn.disabled = true;

    const name = document.getElementById("editName").value.trim();
    const phone = document.getElementById("editPhone").value.trim();

    if (!name || name.length < 2 || !/^[0-9]{7,15}$/.test(phone)) {
        alert("Please enter a valid name and phone number.");
        submitBtn.disabled = false;
        return;
    }

    const userId = localStorage.getItem("userId");

    try {
        await db.collection("users").doc(userId).set({
            name,
            phone
        });
        alert("✅ Profile saved!");
        initProductForm();
        showSection("post");
    } catch (err) {
        console.error("❌ Failed to save profile:", err);
        alert("Failed to save profile.");
    }

    submitBtn.disabled = false;
});

function logoutProfile() {
    localStorage.clear();
    alert("Logged out.");
    location.reload();
}
// Product Posting
function initProductForm() {
    const oldForm = document.getElementById("productForm");
    const newForm = oldForm.cloneNode(true); // remove old listeners
    oldForm.parentNode.replaceChild(newForm, oldForm);

    const form = newForm;
    const preview = document.getElementById("preview");
    const profileWarning = document.getElementById("postProfileWarning");
    const submitBtn = form.querySelector("button[type='submit']");
    const userId = localStorage.getItem("userId");

    // ✅ Re-check profile validity
    db.collection("users").doc(userId).get().then(doc => {
        const user = doc.data();
        const isProfileValid = user?.name?.trim() &&
            /^[0-9]{7,15}$/.test(user?.phone);
        if (!isProfileValid) {
            profileWarning.classList.remove("hidden");
            submitBtn.disabled = true;
        } else {
            profileWarning.classList.add("hidden");
            submitBtn.disabled = false;
        }
    });

    // ✅ Image preview
    form.querySelector("#images").addEventListener("change", (e) => {
        selectedFiles = Array.from(e.target.files).slice(0, 5);
        preview.innerHTML = "";
        selectedFiles.forEach((file, index) => {
            const reader = new FileReader();
            reader.onload = () => {
                const container = document.createElement("div");
                container.className = "preview-box";

                const img = document.createElement("img");
                img.src = reader.result;
                img.loading = "lazy";

                const removeBtn = document.createElement("button");
                removeBtn.textContent = "❌";
                removeBtn.className = "remove-preview-btn";
                removeBtn.onclick = () => {
                    selectedFiles.splice(index, 1); // remove from array
                    container.remove(); // remove from DOM
                };

                container.appendChild(img);
                container.appendChild(removeBtn);
                preview.appendChild(container);
            };
            reader.readAsDataURL(file);
        });

    });

    // ✅ Submit handler
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        submitBtn.disabled = true;

        const title = form.title.value.trim();
        const description = form.description.value.trim();
        const price = parseInt(form.price.value.trim(), 10);
        const category = form.category.value;
        const condition = form.condition.value;


        if (!title || !description || isNaN(price) || !category || selectedFiles.length === 0) {
            alert("Please fill all fields and select at least one image.");
            submitBtn.disabled = false;
            return;
        }

        const userDoc = await db.collection("users").doc(userId).get();
        const user = userDoc.data();
        const name = user?.name?.trim();
        const phone = user?.phone?.trim();

        if (!name || !/^[0-9]{7,15}$/.test(phone)) {
            alert("Profile is incomplete. Please update it first.");
            showSection("profile");
            submitBtn.disabled = false;
            return;
        }

        const spinner = document.getElementById("loadingSpinner");
        const progress = document.getElementById("uploadProgress");
        const banner = document.getElementById("successBanner");

        spinner.classList.remove("hidden");
        progress.classList.remove("hidden");
        progress.value = 0;
        progress.max = selectedFiles.length;
        banner.classList.add("hidden");

        const imageUrls = [];

        try {
            for (const file of selectedFiles) {
                const compressed = await new Promise((res, rej) => {
                    new Compressor(file, {
                        quality: 0.8,
                        maxWidth: 1024,
                        maxHeight: 1024,
                        convertSize: 500000,
                        success: res,
                        error: rej
                    });
                });

                const formData = new FormData();
                formData.append("key", imgbbAPIKey);
                formData.append("image", compressed);

                const res = await fetch("https://api.imgbb.com/1/upload", {
                    method: "POST",
                    body: formData
                });

                const result = await res.json();
                if (!result.success) throw new Error("Upload failed");

                const imageUrl = result.data.url;

                // 🔍 Moderate image with Sightengine
                const isSafe = await checkImageWithSightengine(imageUrl);
                if (!isSafe) {
                    alert("🚫 Prohibited content found in image. Please choose another.");
                    spinner.classList.add("hidden");
                    progress.classList.add("hidden");
                    submitBtn.disabled = false;
                    return;
                }

                imageUrls.push(imageUrl);
                progress.value += 1;
            }

            const product = {
                title,
                description,
                price,
                category,
                condition, // ✅ include here
                imageUrls,
                contact: phone,
                postedBy: {
                    name,
                    phone,
                    userId
                },
                timestamp: Date.now()
            };


            const docRef = await db.collection("posts").add(product);
            await docRef.update({
                id: docRef.id
            });

            form.reset();
            selectedFiles = [];
            preview.innerHTML = "";
            banner.classList.remove("hidden");
            showSection("myposts");

        } catch (err) {
            console.error("Post failed:", err);
            alert("❌ Upload or posting failed. Please try again.");
        }

        spinner.classList.add("hidden");
        progress.classList.add("hidden");
        submitBtn.disabled = false;
    });
}

document.getElementById("productForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const name = form.posterName.value.trim();
    const phone = form.posterPhone.value.trim();
    const title = form.title.value.trim();
    const description = form.description.value.trim();
    const price = parseInt(form.price.value.trim(), 10);
    const category = form.category.value;
    const condition = form.condition.value;

    if (!name || !/^[0-9]{7,15}$/.test(phone) || !title || !description || isNaN(price) || !category || selectedFiles.length === 0) {
        return alert("Fill all fields correctly.");
    }

    localStorage.setItem("userProfile", JSON.stringify({
        name,
        phone
    }));
    const userId = localStorage.getItem("userId");

    const spinner = document.getElementById("loadingSpinner");
    const progress = document.getElementById("uploadProgress");
    const banner = document.getElementById("successBanner");

    spinner.classList.remove("hidden");
    progress.classList.remove("hidden");
    progress.value = 0;
    progress.max = selectedFiles.length;
    banner.classList.add("hidden");

    const imageUrls = [];
    for (const file of selectedFiles) {
        const compressed = await new Promise((res, rej) => {
            new Compressor(file, {
                quality: 0.8,
                maxWidth: 1024,
                maxHeight: 1024,
                convertSize: 500000,
                success: res,
                error: rej
            });
        });

        const formData = new FormData();
        formData.append("key", imgbbAPIKey);
        formData.append("image", compressed);

        const res = await fetch("https://api.imgbb.com/1/upload", {
            method: "POST",
            body: formData
        });

        const result = await res.json();
        if (!result.success) throw new Error("Upload error.");
        imageUrls.push(result.data.url);
        progress.value += 1;
    }

    // Prepare the product data without 'id'
    const product = {
        title,
        description,
        price,
        category,
        condition, // ✅ added
        imageUrls,
        contact: phone,
        postedBy: {
            name,
            phone,
            userId
        },
        timestamp: Date.now()
    };


    // Save product, get docRef and assign Firestore's auto-ID as 'id'
    const docRef = await db.collection("posts").add(product);
    await docRef.update({
        id: docRef.id
    });

    form.reset();
    document.getElementById("preview").innerHTML = "";
    selectedFiles = [];
    banner.classList.remove("hidden");
    spinner.classList.add("hidden");
    progress.classList.add("hidden");
    progress.value = 0;
    marketCache = [];
    showSection("myposts");
});

function changeImage(carouselId, direction) {
    const container = document.getElementById(carouselId);
    const post = marketCache.find(p => `carousel-${p.id}` === carouselId);
    if (!container || !post) return;

    const img = container.querySelector(".carousel-img");
    let currentIndex = parseInt(container.dataset.index || "0", 10);

    currentIndex = (currentIndex + direction + post.imageUrls.length) % post.imageUrls.length;

    img.src = post.imageUrls[currentIndex];
    container.dataset.index = currentIndex;
}


// Market
function renderMarket() {
    const grid = document.getElementById("productsGrid");
    grid.innerHTML = "";

    const expirationLimit = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days

    db.collection("posts")
        .orderBy("timestamp", "desc")
        .onSnapshot(snap => {
            marketCache = [];

            snap.forEach(doc => {
                const data = doc.data();

                // Auto-delete expired posts
                if (data.timestamp < expirationLimit) {
                    doc.ref.delete();
                    return;
                }

                marketCache.push(data);
            });

            const filtered = marketCache.filter(p =>
                (filterCat === "All" || p.category === filterCat) &&
                (p.title + p.description).toLowerCase().includes(filterSearch.toLowerCase())
            );

            grid.innerHTML = "";

            displayProducts(filtered);


            // Show/hide Load More based on pagination if using
            if (typeof showLoadMoreButton === "function") {
                showLoadMoreButton(filtered.length);
            }
        });
}

function displayProducts(filteredList) {
    const grid = document.getElementById("productsGrid");
    grid.innerHTML = "";
    if (filteredList.length === 0) {
        grid.innerHTML = "<p style='grid-column: 1 / -1; text-align:center;'>No products match your filters.</p>";
        return;
    }


    filteredList.forEach(p => {
        const card = document.createElement("div");
        card.className = "card";

        const carouselId = `carousel-${p.id}`;
        const dateObj = new Date(p.timestamp);
        const formattedDate = dateObj.toLocaleDateString("en-GB");
        const formattedTime = dateObj.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        });

        card.innerHTML = `
            <div class="carousel" id="${carouselId}" data-index="0">
                <img src="${p.imageUrls[0]}" loading="lazy" class="carousel-img">
                ${p.imageUrls.length > 1 ? `
                    <button class="carousel-prev" onclick="changeImage('${carouselId}', -1)">◀️</button>
                    <button class="carousel-next" onclick="changeImage('${carouselId}', 1)">▶️</button>
                ` : ""}
            </div>
            <div class="card-details">
                <h4 class="card-title">${p.title}</h4>
                <p class="card-price">₹${p.price}</p>
                <p class="timestamp-label">${formattedDate}, ${formattedTime}</p>
            </div>
        `;

        card.onclick = () => showProductDetails(p);
        grid.appendChild(card);
    });

    if (typeof showLoadMoreButton === "function") {
        showLoadMoreButton(filteredList.length);
    }
}


// My Posts
function renderMyPosts() {
    const grid = document.getElementById("myGrid");
    const userId = localStorage.getItem("userId");

    // Track unread public messages
    const unreadCounts = {};

    // Real-time listener on messages
    db.collection("messages")
        .where("type", "==", "public")
        .onSnapshot(async snapshot => {
            snapshot.forEach(doc => {
                const msg = doc.data();
                if (
                    msg.fromUserId !== userId && // from other users
                    (!msg.seenBy || !msg.seenBy.includes(userId)) && // not seen by this seller
                    msg.productId
                ) {
                    unreadCounts[msg.productId] = (unreadCounts[msg.productId] || 0) + 1;
                }
            });

            // Load seller's posts
            const postSnap = await db.collection("posts")
                .where("postedBy.userId", "==", userId).get();

            grid.innerHTML = "";
            postSnap.forEach(doc => {
                const p = doc.data();
                const unread = unreadCounts[p.id] || 0;

                const card = document.createElement("div");
                card.className = "card";
                card.innerHTML = `
                    <img src="${p.imageUrls[0]}" loading="lazy" style="cursor:pointer" onclick='showProductDetails(${JSON.stringify(p).replace(/"/g, '&quot;')})'>
                    <h4 style="cursor:pointer" onclick='showProductDetails(${JSON.stringify(p).replace(/"/g, '&quot;')})'>${p.title}</h4>

                    <button onclick="openChatThread('${p.id}', '${p.title}', true)" class="chat-btn">
                        💬 Open Chat ${unread > 0 ? `<span class="notif-badge">${unread}</span>` : ""}
                    </button>

                    <button class="delete-btn" onclick="deletePost('${doc.id}')">🗑️ Delete</button>
                `;

                grid.appendChild(card);
            });
        });
}

// Product Details
function showProductDetails(p) {
    showSection("productDetails");
    const wrap = document.getElementById("productDetails");
    const userId = localStorage.getItem("userId");
    const isSeller = userId === p.postedBy.userId;

    wrap.innerHTML = `
    <div class="productDetails-wrapper">
    <button class="back-btn" onclick="showSection('market')">← Back</button>
    <div class="carousel"><img src="${p.imageUrls[0]}" loading="lazy"></div>
    <h2>${p.title}</h2>
    <p>${p.description}</p>
    <p><strong>Price:</strong> ₹${p.price}</p>
    <p><strong>Contact:</strong> ${p.contact}</p>
    <p><strong>Posted by:</strong> ${p.postedBy.name}</p>
    <p class="timestamp-label">🕒 ${new Date(p.timestamp).toLocaleString()}</p>
    <h3>Contact Seller</h3>
    ${
        isSeller
            ? `<p class="quote">You are the seller of this post.</p>`
            : `<button onclick="startPrivateChat('${p.id}', '${p.title}', '${p.postedBy.userId}')">Chat with Seller</button>`
    }
    </div>
`;

}
// Sound notification
function playNotifSound() {
    const sound = document.getElementById("notifSound");
    if (sound) {
        sound.currentTime = 0;
        sound.play().catch(() => {});
    }
}

// Messages Overview
function renderPrivateInbox() {
    console.log("📬 Rendering private inbox only");

    const list = document.getElementById("messagesList");
    list.innerHTML = "Loading...";
    const userId = localStorage.getItem("userId");

    db.collection("messages")
        .where("type", "==", "private")
        .orderBy("timestamp", "desc")
        .onSnapshot(snapshot => {
            list.innerHTML = "";
            const threads = {};

            snapshot.forEach(doc => {
                const msg = doc.data();

                console.log("→ Message type:", msg.type, "| From:", msg.fromName);

                if (msg.type !== "private") return;
                if (msg.fromUserId === msg.toUserId) return;

                const isParticipant = msg.toUserId === userId || msg.fromUserId === userId;
                if (!isParticipant) return;

                const otherUserId = userId === msg.fromUserId ? msg.toUserId : msg.fromUserId;
                const threadId = getThreadId(userId, otherUserId, msg.productId);

                if (!threads[threadId]) {
                    threads[threadId] = {
                        productId: msg.productId,
                        title: msg.productTitle,
                        buyerId: otherUserId,
                        messages: [],
                        unread: 0
                    };
                }

                if (
                    msg.toUserId === userId &&
                    (!msg.seenBy || !msg.seenBy.includes(userId))
                ) {
                    threads[threadId].unread++;
                }

                threads[threadId].messages.push(msg);
            });

            for (const id in threads) {
                const t = threads[id];
                const latest = t.messages[0];

                const card = document.createElement("div");
                card.className = "card";
                card.innerHTML = `
                    <p><strong>${t.title}</strong></p>
                    <p>${latest?.fromName || "User"}: ${latest?.message?.slice(0, 40)}...</p>
                    ${t.unread > 0 ? `<p>🔔 ${t.unread} unread</p>` : ""}
                    <button onclick="openPrivateChat('${t.productId}', '${t.title}', '${t.buyerId}')">Open Thread</button>
                `;
                list.appendChild(card);
            }

            if (Object.keys(threads).length === 0) {
                list.innerHTML = "<p>No private messages yet.</p>";
            }
        });
}

// Open Real-time Chat
function renderMyPosts() {
    const grid = document.getElementById("myGrid");
    const userId = localStorage.getItem("userId");

    // Track unread public messages
    const unreadCounts = {};

    // Real-time listener on messages
    db.collection("messages")
        .where("type", "==", "public")
        .onSnapshot(async snapshot => {
            snapshot.forEach(doc => {
                const msg = doc.data();
                console.log("→ Message type:", msg.type, "| From:", msg.fromName);

                if (
                    msg.fromUserId !== userId && // from other users
                    (!msg.seenBy || !msg.seenBy.includes(userId)) && // not seen by this seller
                    msg.productId
                ) {
                    unreadCounts[msg.productId] = (unreadCounts[msg.productId] || 0) + 1;
                }
            });

            // Load seller's posts
            const postSnap = await db.collection("posts")
                .where("postedBy.userId", "==", userId).get();

            grid.innerHTML = "";
            postSnap.forEach(doc => {
                const p = doc.data();
                const unread = unreadCounts[p.id] || 0;

                const card = document.createElement("div");
                card.className = "card";
                card.innerHTML = `
                    <img src="${p.imageUrls[0]}" loading="lazy" style="cursor:pointer" onclick='showProductDetails(${JSON.stringify(p).replace(/"/g, '&quot;')})'>
                    <h4 style="cursor:pointer" onclick='showProductDetails(${JSON.stringify(p).replace(/"/g, '&quot;')})'>${p.title}</h4>

                    <button onclick="openChatThread('${p.id}', '${p.title}', true)" class="chat-btn">
                        💬 Open Chat ${unread > 0 ? `<span class="notif-badge">${unread}</span>` : ""}
                    </button>

                    <button class="delete-btn" onclick="deletePost('${doc.id}')">🗑️ Delete</button>
                `;

                grid.appendChild(card);
            });
        });
}

function openChatThread(productId, productTitle = "", markAsSeen = false) {
    showSection("chatThread");
    currentThread = productId;
    currentTitle = productTitle;
    document.getElementById("chatProductTitle").textContent = productTitle;

    const chat = document.getElementById("chatMessages");
    chat.innerHTML = "Loading...";
    const userId = localStorage.getItem("userId");

    if (unsubscribeChatListener) unsubscribeChatListener();

    let query = db.collection("messages");
    let threadId = null;

    if (chatMode === "private") {
        if (!chatRecipientId || userId === chatRecipientId) {
            alert("❌ Cannot open private chat with yourself.");
            showSection("messages");
            return;
        }

        threadId = getThreadId(userId, chatRecipientId, productId);
        query = query.where("threadId", "==", threadId).where("type", "==", "private");
    } else {
        query = query.where("productId", "==", productId).where("type", "==", "public");
    }

    query = query.orderBy("timestamp");

    unsubscribeChatListener = query.onSnapshot(snapshot => {
        chat.innerHTML = "";
        const scrollBtn = document.getElementById("scrollToBottomBtn");

        snapshot.forEach(doc => {
            const msg = doc.data();
            const docRef = doc.ref;

            const isMe = msg.fromUserId === userId;
            const isToMe = msg.toUserId === userId || msg.type === "public";
            const notSeen = !msg.seenBy || !msg.seenBy.includes(userId);

            if (markAsSeen && isToMe && notSeen) {
                docRef.update({
                    seenBy: firebase.firestore.FieldValue.arrayUnion(userId)
                });
                playNotifSound();
            }

            if (msg.toUserId === userId && !msg.delivered) {
                docRef.update({
                    delivered: true
                });
            }

            const bubble = document.createElement("div");
            bubble.className = `message-bubble ${isMe ? "message-right" : "message-left"}`;

            let ticks = "";
            if (isMe && chatMode === "private") {
                const otherUserId = msg.fromUserId === userId ? msg.toUserId : msg.fromUserId;
                if (msg.seenBy?.includes(otherUserId)) {
                    ticks = `<span class="tick blue">✔✔</span>`;
                } else if (msg.delivered) {
                    ticks = `<span class="tick">✔✔</span>`;
                } else {
                    ticks = `<span class="tick">✔</span>`;
                }
            }

            bubble.innerHTML = `
                ${!isMe ? `
                    <div class="chat-avatar">${msg.fromName?.charAt(0).toUpperCase()}</div>
                    <strong>${msg.fromName}</strong><br>` : ""}
                ${msg.message}
                <span class="timestamp">${new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                })} ${ticks}</span>
            `;

            if (isMe) {
                bubble.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    if (confirm("Delete this message?")) {
                        docRef.delete().catch(() => alert("Delete failed"));
                    }
                });

                let pressTimer;
                bubble.addEventListener("touchstart", () => {
                    pressTimer = setTimeout(() => {
                        if (confirm("Delete this message?")) {
                            docRef.delete().catch(() => alert("Delete failed"));
                        }
                    }, 600);
                });
                bubble.addEventListener("touchend", () => clearTimeout(pressTimer));
                bubble.addEventListener("touchmove", () => clearTimeout(pressTimer));
            }

            chat.appendChild(bubble);
        });

        if (chat.scrollHeight - chat.scrollTop > chat.clientHeight + 100) {
            scrollBtn.classList.remove("hidden");
        } else {
            scrollBtn.classList.add("hidden");
        }

        chat.scrollTop = chat.scrollHeight;
    });
}


function openPrivateChat(productId, productTitle, buyerId) {
    chatMode = "private";
    chatRecipientId = buyerId;
    openChatThread(productId, productTitle, true); // markAsSeen = true
}

function startPrivateChat(productId, productTitle, sellerId) {
    const userId = localStorage.getItem("userId");

    if (userId === sellerId) {
        alert("❌ You cannot start a private chat with yourself.");
        return;
    }

    chatMode = "private";
    chatRecipientId = sellerId;
    openChatThread(productId, productTitle, true); // mark as seen = true
}


// Send Text Message
async function sendReply() {
    const sendBtn = document.querySelector(".chat-input-box button:last-child"); // ➤ button
    sendBtn.disabled = true;

    const replyInput = document.getElementById("replyText");
    const msgText = replyInput.value.trim();
    if (!msgText) {
        sendBtn.disabled = false;
        return;
    }

    const userId = localStorage.getItem("userId");
    const userDoc = await db.collection("users").doc(userId).get();
    const user = userDoc.data() || {};
    const name = user.name?.trim();
    const phone = user.phone?.trim();

    if (!name || !/^[0-9]{7,15}$/.test(phone)) {
        alert("Your profile is incomplete.");
        sendBtn.disabled = false;
        return;
    }

    const msgData = {
        type: chatMode,
        productId: currentThread,
        productTitle: currentTitle,
        fromUserId: userId,
        fromName: name,
        phone,
        message: msgText,
        timestamp: Date.now(),
        seenBy: [],
        delivered: false
    };

    if (chatMode === "private") {
        msgData.threadId = getThreadId(userId, chatRecipientId, currentThread);
        msgData.toUserId = chatRecipientId;
    }

    try {
        await db.collection("messages").add(msgData);
        replyInput.value = ""; // ✅ Clear on success
    } catch (err) {
        alert("Failed to send message. Please try again.");
        console.error(err);
    }

    sendBtn.disabled = false;
}

// Send File/Image
async function sendFile() {
    const attachBtn = document.querySelector(".chat-input-box button:nth-child(2)"); // 📎 button
    attachBtn.disabled = true;

    const fileInput = document.getElementById("chatFileInput");
    const file = fileInput.files[0];

    if (!file || !file.type.startsWith("image/")) {
        alert("Only image files are allowed.");
        attachBtn.disabled = false;
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        alert("Image too large. Please select one under 10MB.");
        attachBtn.disabled = false;
        return;
    }

    const caption = prompt("Enter a caption (optional):");
    const status = document.getElementById("chatUploadStatus");
    const progressBar = document.getElementById("imageUploadProgress");

    status.classList.remove("hidden");
    progressBar.classList.remove("hidden");
    progressBar.value = 0;

    let fakeProgress = 0;
    const interval = setInterval(() => {
        fakeProgress += Math.random() * 10;
        progressBar.value = Math.min(fakeProgress, 95);
    }, 150);

    const userId = localStorage.getItem("userId");
    const userDoc = await db.collection("users").doc(userId).get();
    const user = userDoc.data() || {};
    const name = user.name?.trim();
    const phone = user.phone?.trim();

    const isValid = name && phone && /^[0-9]{7,15}$/.test(phone);
    if (!isValid) {
        clearInterval(interval);
        progressBar.classList.add("hidden");
        status.classList.add("hidden");
        attachBtn.disabled = false;
        const go = confirm("Your profile is incomplete.\n\nClick OK to go to your profile.");
        if (go) showSection("profile");
        return;
    }

    try {
        const compressed = await new Promise((res, rej) => {
            new Compressor(file, {
                quality: 0.8,
                maxWidth: 1280,
                maxHeight: 1280,
                convertSize: 500000,
                success: res,
                error: rej
            });
        });

        const formData = new FormData();
        formData.append("key", imgbbAPIKey);
        formData.append("image", compressed);

        const uploadRes = await fetch("https://api.imgbb.com/1/upload", {
            method: "POST",
            body: formData
        });

        const result = await uploadRes.json();
        if (!result.success) throw new Error("Upload failed");

        const imageUrl = result.data.url;
        const imageHtml = `
            <img src="${imageUrl}" alt="Image" style="max-width: 100%; border-radius: 8px;">
            ${caption ? `<div style="font-size: 0.9rem; margin-top: 4px;">${caption}</div>` : ""}
        `;

        const msgData = {
            type: chatMode,
            productId: currentThread,
            productTitle: currentTitle,
            fromUserId: userId,
            fromName: name,
            phone,
            message: imageHtml,
            timestamp: Date.now(),
            seenBy: [],
            delivered: false
        };

        if (chatMode === "private") {
            msgData.threadId = `${currentThread}_${userId}`;
            msgData.toUserId = chatRecipientId;
        }

        await db.collection("messages").add(msgData);

        // ✅ Reset UI
        fileInput.value = "";
    } catch (err) {
        alert("Failed to send file.");
        console.error(err);
    }

    // ✅ Cleanup UI
    clearInterval(interval);
    progressBar.classList.add("hidden");
    status.classList.add("hidden");
    attachBtn.disabled = false;
}


let chatMode = "public"; // default mode

function switchChatMode(mode) {
    chatMode = mode;
    document.getElementById("publicTab").classList.toggle("active", mode === "public");
    document.getElementById("privateTab").classList.toggle("active", mode === "private");
    openChatThread(currentThread, currentTitle); // reload chat view
}

async function checkImageWithSightengine(imageUrl) {
    const url = `https://api.sightengine.com/1.0/check.json?models=nudity,wad&api_user=${SIGHTENGINE_USER}&api_secret=${SIGHTENGINE_SECRET}&url=${encodeURIComponent(imageUrl)}`;

    const res = await fetch(url);
    const result = await res.json();

    if (result.status !== "success") {
        console.error("Sightengine error:", result);
        throw new Error("Failed to check image content.");
    }

    const {
        nudity,
        weapon,
        alcohol,
        drugs
    } = result;

    const isUnsafe =
        nudity.safe < 0.5 ||
        nudity.raw > 0.2 ||
        weapon > 0.3 ||
        drugs > 0.3;

    return !isUnsafe;
}


function scrollChatToBottom() {
    const chat = document.getElementById("chatMessages");
    chat.scrollTop = chat.scrollHeight;
    document.getElementById("scrollToBottomBtn").classList.add("hidden");
}

function deleteMessage(path) {
    if (confirm("Delete this message?")) {
        db.doc(path).delete().catch(() => alert("Failed to delete message."));
    }
}

function deletePost(postId) {
    if (confirm("Are you sure you want to delete this post?")) {
        db.collection("posts").doc(postId).delete().catch(() => {
            alert("Failed to delete post.");
        });
    }
}

function disableTemporarily(btn, duration = 2000) {
    btn.disabled = true;
    setTimeout(() => btn.disabled = false, duration);
}

function setupPrivateInboxWatcher() {
    const userId = localStorage.getItem("userId");
    if (!userId) return;

    db.collection("messages")
        .where("type", "==", "private") // ✅ only private messages
        .orderBy("timestamp", "desc")
        .onSnapshot(() => {
            const isMessagesTabActive = document
                .getElementById("messages")
                ?.classList.contains("active");

            if (isMessagesTabActive) {
                renderPrivateInbox(); // ✅ updated name here
            }
        });
}

function setWelcomeMessage() {
    const welcomeSpan = document.getElementById("welcomeMsg");
    if (!welcomeSpan) return;

    const userId = localStorage.getItem("userId");
    if (!userId) {
        welcomeSpan.textContent = "Welcome";
        return;
    }

    db.collection("users").doc(userId).get().then(doc => {
        const user = doc.data() || {};
        const name = user.name?.trim();

        if (name && name.length >= 2) {
            welcomeSpan.textContent = `Welcome, ${name}`;
        } else {
            welcomeSpan.textContent = `Welcome`;
        }
    }).catch(err => {
        console.error("Failed to load user profile:", err);
        welcomeSpan.textContent = "Welcome";
    });
}