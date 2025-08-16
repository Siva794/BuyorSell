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
let unsubscribeInboxWatcher = null;
let chatRecipientId = null;
let currentUser = null;
let marketPollInterval = null;
let lastVisibleMessage = null;
let loadingOlderMessages = false;
let hasReachedEnd = false;
let isFiltering = false; // 🧠 tells renderMarket to fetch all posts
let inboxPollInterval = null;

const CHAT_PAGE_SIZE = 20;
if (typeof window.fetchUnreadCount === "function") {
    window.fetchUnreadCount();
}


window.__activeSection = null;
window.__showSectionCount = 0;

// 🔍 Global Firebase read tracker
window.__readCount = 0;

function trackedRead(label) {
    window.__readCount++;
    console.log(`📥 READ #${window.__readCount} — ${label}`);
}


async function ensureProfileComplete() {
    const userId = firebase.auth().currentUser?.uid;
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

// 👤 Helper to convert phone to pseudo-email
function mobileToEmail(phone) {
    return `${phone}@buyorsell.com`; // domain just used internally
}

// ✅ Check auth on load
// 🔐 Listen for login/logout state changes
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        console.log("🔐 Logged in:", user.uid);
        localStorage.setItem("userId", user.uid);

        // 🧾 Initialize product posting form
        initProductForm();
        renderPrivateInbox(); // 🔄 Initial fetch

        // 📦 Use cached profile if available
        const cached = localStorage.getItem("userProfile");
        if (cached) {
            try {
                currentUser = JSON.parse(cached);
            } catch {
                console.warn("⚠️ Corrupt profile cache, refetching...");
            }
        }

        // 📂 Fetch from Firestore only if not cached
        if (!currentUser) {
            try {
                trackedRead("🔐 Auth: Checking if user profile exists");

                const doc = await db.collection("users").doc(user.uid).get();
                const data = doc.data() || {};

                if (!doc.exists) {
                    await db.collection("users").doc(user.uid).set({
                        name: "",
                        phone: ""
                    });
                    console.log("🆕 Created blank user profile.");
                } else {
                    currentUser = data;
                    localStorage.setItem("userProfile", JSON.stringify(data));
                }
            } catch (err) {
                console.error("⚠️ Failed to fetch/create profile:", err);
            }
        }

        // ⏰ Start periodic activity tracking
        startLastSeenUpdater();

        // 🔔 Unread badge polling
        setupMessageBadge();

        // 🧠 Show correct name and buttons
        loadProfileView();

    } else {
        console.log("🚪 Not logged in");

        // 🧹 Cleanup
        localStorage.removeItem("userId");
        localStorage.removeItem("userProfile");
        currentUser = null;

        if (badgePollInterval) clearInterval(badgePollInterval);
        if (marketPollInterval) clearInterval(marketPollInterval);

        const badge = document.querySelector(".nav-messages-btn .msg-badge");
        if (badge) {
            badge.textContent = "";
            badge.classList.add("hidden");
        }

        // Show guest view
        loadProfileView();
    }
});

function setupInboxPolling() {
    const messagesTab = document.getElementById("messages");

    const checkAndFetch = () => {
        if (messagesTab?.classList.contains("active")) {
            renderPrivateInbox(); // ✅ Also updates badge
        }
    };

    // Run immediately
    checkAndFetch();

    // Start polling if not already started
    if (!inboxPollInterval) {
        inboxPollInterval = setInterval(checkAndFetch, 20000); // every 20 sec
    }
}

function stopInboxPolling() {
    if (inboxPollInterval) {
        clearInterval(inboxPollInterval);
        inboxPollInterval = null;
    }
}


function getThreadId(userA, userB, productId) {
    const sorted = [userA, userB].sort();
    return `${sorted[0]}_${sorted[1]}_${productId}`;
}

function getThreadId(buyerId, sellerId, productId) {
    const ids = [buyerId, sellerId].sort(); // ensures consistent order
    return `${ids[0]}_${ids[1]}_${productId}`;
}

if (!window.__eventListenersAttached) {
    window.__eventListenersAttached = true;

    // ✅ Add load listener once
    window.addEventListener("load", () => {
        const section = location.hash.replace("#", "") || "market";
        showSection(section, true);
    });

    // ✅ Add hashchange listener once
    window.addEventListener("hashchange", () => {
        const id = location.hash.replace("#", "");
        if (window.__activeSection === id) return;
        showSection(id, true);
    });

    // ✅ Add DOMContentLoaded listener once
    document.addEventListener("DOMContentLoaded", () => {
        initNav(); // nav buttons
        initFilters(); // filter bar
        initMarketCarousel(); // optional
    });
}


document.addEventListener("DOMContentLoaded", () => {
    // ✅ Ensure userId exists for local use
    if (!localStorage.getItem("userId")) {
        const newId = crypto.randomUUID();
        localStorage.setItem("userId", newId);
        console.log("🔐 Created new userId:", newId);
    }


    // ✅ Initialize app features
    initNav();
    initProductForm(); // Also called above when logged in

    initFilters();
    setupMessageBadge();
    setWelcomeMessage();
    restrictPhoneInput("signUpPhone");
    restrictPhoneInput("signInPhone");
    initMarketCarousel();

    // ✅ Toggle mobile filter dropdown
    const filterToggleBtn = document.getElementById("filterToggleBtn");
    const filterDropdown = document.getElementById("filterDropdown");

    if (filterToggleBtn && filterDropdown) {
        filterToggleBtn.addEventListener("click", () => {
            filterDropdown.classList.toggle("hidden");

            const isMobile = window.innerWidth <= 768;
            const nowVisible = !filterDropdown.classList.contains("hidden");

            if (isMobile && nowVisible) {
                window.scrollTo({
                    top: 0,
                    behavior: "smooth"
                });
            }
        });

        const dropdownSelects = filterDropdown.querySelectorAll("select");
        dropdownSelects.forEach(select => {
            select.addEventListener("change", () => {
                if (window.innerWidth < 768) {
                    filterDropdown.classList.add("hidden");
                }
            });
        });
    }

    // ✅ Load More button
    const loadMoreBtn = document.getElementById("loadMoreBtn");
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener("click", () => {
            if (!isLoadingMore) renderMarket(false);
        });
    }


    // ✅  Press Enter to Send
    document.getElementById("replyText").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendReply();
        }
    });


    // ✅ Toggle desktop menu dropdown
    const menuBtn = document.getElementById("menuBtn");
    const dropdown = document.querySelector(".menuDropdown");

    let dropdownOpen = false;

    if (menuBtn && dropdown) {
        // Toggle dropdown when button is clicked
        menuBtn.addEventListener("click", (e) => {
            e.stopPropagation(); // Prevent outside click handler
            dropdownOpen = !dropdownOpen;
            dropdown.classList.toggle("hidden", !dropdownOpen);
            menuBtn.classList.toggle("active", dropdownOpen);
            menuBtn.setAttribute("aria-expanded", dropdownOpen.toString());
        });

        // Close dropdown on outside click
        document.addEventListener("click", () => {
            if (dropdownOpen) {
                dropdown.classList.add("hidden");
                menuBtn.classList.remove("active");
                menuBtn.setAttribute("aria-expanded", "false");
                dropdownOpen = false;
            }
        });

        // Close dropdown when clicking a menu item
        dropdown.addEventListener("click", (e) => {
            if (e.target.matches("button[data-nav]")) {
                // Add any custom navigation logic here if needed later
                dropdown.classList.add("hidden");
                menuBtn.classList.remove("active");
                menuBtn.setAttribute("aria-expanded", "false");
                dropdownOpen = false;
            }
        });
    }


    // ✅ Hook up nav buttons (data-nav)
    document.querySelectorAll("button[data-nav]").forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.nav;
            if (target) showSection(target);
        });
    });
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

let lastLoadedProductId = null;
let isProductLoading = false;


// ✅ Show a specific section
// ✅ Show a specific section based on ID or hash
// ✅ Show a specific section based on ID or URL hash
function showSection(id, skipHashUpdate = false) {
    if (!id) id = "market"; // fallback to market if no section specified

    // 🧮 Track how many times showSection is called
    window.__showSectionCount = (window.__showSectionCount || 0) + 1;
    console.log("📦 showSection() call #", window.__showSectionCount);

    // 🔁 Prevent reloading the same section repeatedly
    if (window.__activeSection === id) {
        console.log(`⛔ Skipping showSection(${id}) — already active`);
        return;
    }

    // 📍 Set current active section
    window.__activeSection = id;
    console.log(`📦 showSection('${id}') triggered`);

    // 🔎 1. Handle special case: product detail view
    if (id.startsWith("product-")) {
        const productId = id.replace("product-", "");

        // 🛑 Avoid refetching same product or fetching while already loading
        if (productId === window.lastLoadedProductId || window.isProductLoading) return;

        window.isProductLoading = true;
        window.lastLoadedProductId = productId;

        // 👁️ Show product detail section
        document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
        document.getElementById("productDetails")?.classList.add("active");

        // 🔁 Update hash only if needed
        if (!skipHashUpdate && location.hash !== `#${id}`) {
            location.hash = `#${id}`;
        }

        // 📦 Load the product from Firestore
        loadProductById(productId);
        return;
    }

    // ✅ 2. Validate section ID
    const section = document.getElementById(id);
    if (!section) {
        console.warn(`⚠️ Section "${id}" not found. Falling back to "market".`);
        return showSection("market", skipHashUpdate);
    }

    // 🔁 3. Hide all sections first
    document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));

    // 🔕 Stop chat listener if leaving chat section
    if (unsubscribeChatListener) {
        unsubscribeChatListener();
        unsubscribeChatListener = null;
    }

    // 🧼 Remove chat online indicator if not in chat
    if (id !== "chatThread") {
        const statusEl = document.getElementById("chatStatusIndicator");
        if (statusEl) statusEl.remove();
    }

    // ✅ 4. Show selected section
    section.classList.add("active");

    // ✅ 5. Highlight corresponding nav button
    document.querySelectorAll("button[data-nav]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.nav === id);
    });

    // 🔁 6. Update the hash only if needed
    if (!skipHashUpdate && location.hash !== `#${id}`) {
        location.hash = `#${id}`;
    }

    // ✅ 7. Section-specific logic
    if (id === "market") {
        // 🧼 Reset pagination state
        // 🔄 Clear cached full-load if any
        if (!sessionStorage.getItem("marketFullCache")) {
            marketCache = [];
            lastVisibleDoc = null;
            hasReachedEnd = false;
        }

        // ✅ Show Load More button again
        const loadMoreBtn = document.getElementById("loadMoreBtn");
        if (loadMoreBtn) loadMoreBtn.style.display = "block";

        // 🔄 Re-render market from first page
        renderMarket(true);

        // ♻️ Poll market every 2 mins if not at end
        if (marketPollInterval) clearInterval(marketPollInterval);
        // ✅ Remove market polling — rely on manual refresh
        if (marketPollInterval) {
            clearInterval(marketPollInterval);
            marketPollInterval = null;
        }

    }




    if (id === "myposts") {
        renderMyPosts?.(); // 📝 Load user's posts
    }

    if (id === "profile") {
        loadProfileView?.(); // 👤 Load user profile
    }

    if (id === "messages") {
        renderPrivateInbox?.(); // 💬 Load inbox contents
        window.fetchUnreadCount?.(); // 🔔 Update badge (if used separately)

        clearInterval(inboxPollInterval); // Prevent duplicates
        inboxPollInterval = setInterval(() => {
            renderPrivateInbox?.();
        }, 30000); // Poll every 30 seconds
    } else {
        clearInterval(inboxPollInterval); // Stop polling when leaving inbox
    }



    // ⏱️ Allow switching again after short delay
    setTimeout(() => {
        window.__activeSection = null;
    }, 300);
}

// ✅ Trigger correct section on page load
window.addEventListener("load", () => {
    const initialSection = location.hash.replace("#", "") || "market";
    showSection(initialSection, true); // don't re-update hash
});

// ✅ Respond to browser back/forward navigation
window.addEventListener("hashchange", () => {
    const id = location.hash.replace("#", "");
    if (window.__activeSection === id) return; // skip if already active
    showSection(id, true);
});


// ✅ Optional: Automatically hook up data-nav buttons
document.querySelectorAll("button[data-nav]").forEach(btn => {
    btn.addEventListener("click", () => {
        showSection(btn.dataset.nav);
    });
});

// Message Badge
let unreadCount = 0;
let badgePollInterval = null;

function setupMessageBadge() {
    const userId = firebase.auth().currentUser?.uid;
    const badge = document.querySelector(".nav-messages-btn .msg-badge");

    if (!userId || !badge) return;

    async function fetchUnreadCount() {
        try {
            trackedRead("🔔 fetchUnreadCount: inbox_summary");
            const doc = await db.collection("inbox_summary").doc(userId).get();
            const data = doc.data() || {};

            const unread = data.unreadCount || 0;

            if (unread !== unreadCount) {
                unreadCount = unread;
                badge.textContent = unread;
                badge.classList.toggle("hidden", unread === 0);
            }
        } catch (err) {
            console.error("⚠️ Failed to fetch unread summary:", err);
        }
    }

    // 🔓 Expose it globally so it can be called elsewhere
    window.fetchUnreadCount = fetchUnreadCount;

    // Initial + periodic poll
    fetchUnreadCount();
    if (badgePollInterval) clearInterval(badgePollInterval);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && typeof fetchUnreadCount === "function") {
            fetchUnreadCount();
        }
    });

}


// Filters
function initFilters() {
    const desktop = {
        type: document.getElementById("categoryFilter"),
        order: document.getElementById("sortBy"),
        min: document.getElementById("minPrice"),
        max: document.getElementById("maxPrice"),
        condition: document.getElementById("filterCondition"),
        applyBtn: document.getElementById("applyDesktopFiltersBtn"),
        resetBtn: document.getElementById("resetDesktopFiltersBtn"),
    };

    const mobile = {
        type: document.getElementById("mobileCategoryFilter"),
        order: document.getElementById("mobileSortBy"),
        min: document.getElementById("mobileMinPrice"),
        max: document.getElementById("mobileMaxPrice"),
        condition: document.getElementById("mobileFilterCondition"),
        applyBtn: document.getElementById("applyMobileFiltersBtn"),
        resetBtn: document.getElementById("resetMobileFiltersBtn"),
    };

    // ✅ Restore previous filters from session
    const savedFilters = JSON.parse(sessionStorage.getItem("marketFilters") || "{}");

    if (savedFilters) {
        desktop.type.value = savedFilters.type || "All";
        desktop.order.value = savedFilters.order || "latest";
        desktop.min.value = savedFilters.min || "";
        desktop.max.value = savedFilters.max || "";
        desktop.condition.value = savedFilters.condition || "";

        mobile.type.value = savedFilters.type || "All";
        mobile.order.value = savedFilters.order || "latest";
        mobile.min.value = savedFilters.min || "";
        mobile.max.value = savedFilters.max || "";
        mobile.condition.value = savedFilters.condition || "";

        const searchBox = document.getElementById("searchInput") || document.getElementById("searchBar");
        if (searchBox && savedFilters.search) {
            searchBox.value = savedFilters.search;
        }
    }

    setTimeout(() => {
        if (typeof window.applyFilters === "function") {
            window.applyFilters();
        }
    }, 200);


    const applyFilters = async () => {
        const isMobile = window.innerWidth < 768;
        const active = isMobile ? mobile : desktop;

        const selectedType = active.type?.value || "";
        const selectedOrder = active.order?.value || "latest";
        const minPrice = parseFloat(active.min?.value) || 0;
        const maxPrice = parseFloat(active.max?.value) || Infinity;
        const selectedCondition = active.condition?.value || "";
        const searchInput = document.getElementById("searchInput")?.value.trim().toLowerCase() || "";

        // 🔄 Reset state
        marketCache = [];
        lastVisibleDoc = null;
        hasReachedEnd = false;

        try {
            // ✅ Load posts from session cache or Firestore
            const cached = sessionStorage.getItem("marketFullCache");

            if (cached) {
                console.log("📦 Using cached posts from sessionStorage");
                marketCache = JSON.parse(cached);
            } else {
                console.log("🌐 Fetching posts from Firestore for filtering");
                const snap = await db.collection("posts").orderBy("timestamp", "desc").get();

                marketCache = snap.docs.map(doc => ({
                    ...doc.data(),
                    id: doc.id
                }));

                sessionStorage.setItem("marketFullCache", JSON.stringify(marketCache));
            }

            // ✅ Apply filters
            const filtered = marketCache.filter(product => {
                const matchesType = selectedType === "All" || !selectedType || product.category.includes(selectedType);
                const matchesPrice = product.price >= minPrice && product.price <= maxPrice;
                const matchesCondition = !selectedCondition || product.condition === selectedCondition;
                const matchesSearch = !searchInput || (product.title + " " + product.description).toLowerCase().includes(searchInput);
                return matchesType && matchesPrice && matchesCondition && matchesSearch;
            });

            // ✅ Sort
            if (selectedOrder === "price_low_high") {
                filtered.sort((a, b) => a.price - b.price);
            } else if (selectedOrder === "price_high_low") {
                filtered.sort((a, b) => b.price - a.price);
            } else if (selectedOrder === "latest") {
                filtered.sort((a, b) => b.timestamp - a.timestamp);
            } else if (selectedOrder === "oldest") {
                filtered.sort((a, b) => a.timestamp - b.timestamp);
            } else if (selectedOrder === "title_asc") {
                filtered.sort((a, b) => a.title.localeCompare(b.title));
            } else if (selectedOrder === "title_desc") {
                filtered.sort((a, b) => b.title.localeCompare(a.title));
            }

            // ✅ Hide Load More while filtering
            const btn = document.getElementById("loadMoreBtn");
            if (btn) btn.style.display = "none";


            // ✅ Cache filters to sessionStorage
            const filters = {
                type: selectedType,
                order: selectedOrder,
                min: active.min?.value || "",
                max: active.max?.value || "",
                condition: selectedCondition,
                search: searchInput
            };
            sessionStorage.setItem("marketFilters", JSON.stringify(filters));


            displayProducts(filtered);

        } catch (err) {
            console.error("❌ Filter fetch failed:", err);
            showToast("Failed to apply filters. Try again.", "error");
        }
    };

    const resetFilters = (group) => {
        if (group.type) group.type.value = "All";
        if (group.order) group.order.value = "latest";
        if (group.min) group.min.value = "";
        if (group.max) group.max.value = "";
        if (group.condition) group.condition.value = "";

        sessionStorage.removeItem("marketFullCache");
        marketCache = [];
        lastVisibleDoc = null;
        hasReachedEnd = false;

        const btn = document.getElementById("loadMoreBtn");
        if (btn) btn.style.display = "block";

        renderMarket(true);
    };

    // ✅ Bind change listeners
    [desktop, mobile].forEach(group => {
        [group.type, group.order, group.min, group.max, group.condition].forEach(input => {
            if (input) input.addEventListener("change", applyFilters);
        });
    });

    // ✅ Bind Apply/Reset buttons
    if (desktop.applyBtn) desktop.applyBtn.addEventListener("click", applyFilters);
    if (mobile.applyBtn) mobile.applyBtn.addEventListener("click", applyFilters);
    if (desktop.resetBtn) desktop.resetBtn.addEventListener("click", () => resetFilters(desktop));
    if (mobile.resetBtn) mobile.resetBtn.addEventListener("click", () => resetFilters(mobile));

    // ✅ Make available globally (for search input to access)
    window.applyFilters = applyFilters;
}

// ✅ Call this after DOM content is loaded
initFilters();

// ✅ Search input: trigger on typing (with debounce)
document.getElementById("searchInput")?.addEventListener("input", debounce(() => {
    if (typeof window.applyFilters === "function") {
        window.applyFilters();
    }
}, 300));

// ✅ Search input: trigger on Enter key
document.getElementById("searchInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        if (typeof window.applyFilters === "function") {
            window.applyFilters();
        }
    }
});

// ✅ Debounce helper
function debounce(fn, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}


// Profile
function loadProfileFields() {
    const userId = firebase.auth().currentUser?.uid;

    // Try local cache first
    const cached = localStorage.getItem("userProfile");
    if (cached) {
        try {
            const user = JSON.parse(cached);
            document.getElementById("editName").value = user.name || "";
            document.getElementById("editPhone").value = user.phone || "";
            return;
        } catch (e) {
            console.warn("⚠️ Failed to parse profile from cache:", e);
        }
    }

    // Fallback to Firestore if cache fails
    db.collection("users").doc(userId).get().then(doc => {
        const user = doc.data() || {};
        document.getElementById("editName").value = user.name || "";
        document.getElementById("editPhone").value = user.phone || "";

        // ✅ Update cache after load
        localStorage.setItem("userProfile", JSON.stringify(user));
    });
}


document.getElementById("profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const form = e.target;
    const name = form.editName.value.trim();
    const phone = form.editPhone.value.trim();
    const submitBtn = form.querySelector("button[type='submit']");

    if (!name || name.length < 2) {
        showToast("Please enter a valid name.");
        return;
    }

    if (!/^[0-9]{7,15}$/.test(phone)) {
        showToast("Invalid phone number format.");
        return;
    }

    submitBtn.disabled = true;

    const userId = firebase.auth().currentUser?.uid;
    try {
        await db.collection("users").doc(userId).set({
            name,
            phone
        });

        // ✅ Auto-refresh local cache after save
        localStorage.setItem("userProfile", JSON.stringify({
            name,
            phone
        }));

        showToast("✅ Profile saved!", "success");
        initProductForm();
        showSection("post");
    } catch (err) {
        showToast("Failed to save profile.", "error");
        console.error(err);
    } finally {
        submitBtn.disabled = false;
    }
});

// 🔙 Cancel button logic (in same block)
document.getElementById("cancelEditProfile").addEventListener("click", () => {
    showSection("profile");
    loadProfileView();
});

function logoutProfile() {
    localStorage.clear();
    alert("Logged out.");
    location.reload();
}
// Product Posting
async function initProductForm() {
    const oldForm = document.getElementById("productForm");
    const newForm = oldForm.cloneNode(true); // remove old listeners
    oldForm.parentNode.replaceChild(newForm, oldForm);

    const form = newForm;
    const preview = document.getElementById("preview");
    const profileWarning = document.getElementById("postProfileWarning");
    const submitBtn = form.querySelector("button[type='submit']");
    const userId = firebase.auth().currentUser?.uid;
    const user = firebase.auth().currentUser;

    // ✅ Re-check profile validity
    if (!user) {
        profileWarning.classList.remove("hidden");
        submitBtn.disabled = true;
        return;
    }

    try {
        const doc = await db.collection("users").doc(user.uid).get();
        const data = doc.data();

        const isProfileValid =
            data?.name?.trim() &&
            /^[0-9]{7,15}$/.test(data?.phone);

        if (isProfileValid) {
            profileWarning.classList.add("hidden");
            submitBtn.disabled = false;
        } else {
            profileWarning.classList.remove("hidden");
            submitBtn.disabled = true;
        }
    } catch (err) {
        console.error("❌ Failed to load profile data:", err);
        profileWarning.classList.remove("hidden");
        submitBtn.disabled = true;
    }
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

        const cached = localStorage.getItem("userProfile");
        const user = cached ? JSON.parse(cached) : {};

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
    const userId = firebase.auth().currentUser?.uid;

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
async function renderMarket(initialLoad = true, fullLoad = false) {
    const btn = document.getElementById("loadMoreBtn");
    if (btn && !fullLoad) {
        btn.style.display = "block";
    }

    const grid = document.getElementById("productsGrid");
    if (!grid) return;

    if (initialLoad) {
        grid.innerHTML = "<p class='loading-text'>Loading products...</p>";
        marketCache = [];
        lastVisibleDoc = null;
        hasReachedEnd = false;
    }

    if (hasReachedEnd) {
        console.log("🚫 No more products to load.");
        return;
    }

    const expirationLimit = Date.now() - (30 * 24 * 60 * 60 * 1000);

    try {
        let query = db.collection("posts").orderBy("timestamp", "desc");

        if (!fullLoad) {
            query = query.limit(postsPerPage);
            if (lastVisibleDoc) {
                query = query.startAfter(lastVisibleDoc);
            }
        }

        trackedRead("📦 renderMarket: fetching posts");

        const snap = await query.get();

        // ✅ Detect end of list
        if (snap.empty || snap.docs.length < postsPerPage) {
            hasReachedEnd = true;

            const btn = document.getElementById("loadMoreBtn");
            if (btn) btn.style.display = "none";
        }

        const newItems = [];

        snap.forEach(doc => {
            const data = doc.data();

            if (data.timestamp < expirationLimit) {
                doc.ref.delete();
                return;
            }

            const item = {
                ...data,
                id: doc.id
            };

            if (!marketCache.find(p => p.id === item.id)) {
                marketCache.push(item);
                newItems.push(item);
            }
        });

        if (snap.docs.length > 0) {
            lastVisibleDoc = snap.docs[snap.docs.length - 1];
        }

        // ✅ Updated filter values from live DOM
        const currentType = document.getElementById("categoryFilter")?.value || "All";
        const currentSearch = document.getElementById("searchInput")?.value.trim().toLowerCase() || "";
        const currentCondition = document.getElementById("filterCondition")?.value || "";

        // ✅ Filter based on user input
        const filtered = marketCache.filter(p =>
            (currentType === "All" || p.category === currentType) &&
            (p.title + " " + p.description).toLowerCase().includes(currentSearch) &&
            (!currentCondition || p.condition === currentCondition)
        );

        if (initialLoad) {
            grid.innerHTML = "";
        }

        displayProducts(filtered);

        if (typeof showLoadMoreButton === "function") {
            showLoadMoreButton(filtered.length);
        }

    } catch (err) {
        console.error("⚠️ Failed to load market:", err);
        grid.innerHTML = "<p>⚠️ Error loading products. Try again.</p>";
    }
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        console.log("⏸ Pausing background polling");
        clearInterval(badgePollInterval);
        clearInterval(marketPollInterval);
    } else {
        console.log("▶️ Resuming polling");
        if (typeof window.fetchUnreadCount === "function") {
            badgePollInterval = setInterval(() => {
                window.fetchUnreadCount();
            }, 2 * 60 * 1000);
        }

        if (!hasReachedEnd) {
            marketPollInterval = setInterval(() => renderMarket(false), 2 * 60 * 1000);
        }
    }
});


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

// Product Details
function showProductDetails(p) {
    showSection("productDetails");
    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

    const wrap = document.getElementById("productDetails");
    const userId = firebase.auth().currentUser?.uid;
    const isSeller = userId === p.postedBy.userId;
    const uid = Date.now();

    // Construct product details HTML
    wrap.innerHTML = `
    <div class="productDetails-wrapper">
      <button class="back-btn" onclick="showSection('market')">← Back</button>
      <div class="productDetails-grid">
        <!-- Left: Image Carousel -->
        <div class="product-image-column">
          <div class="carousel-container" id="carousel-${uid}">
            <button class="carousel-btn left">&#10094;</button>
            <div class="carousel-image-wrapper" id="imgWrap-${uid}">
              <img id="productImage-${uid}" class="carousel-image" src="${p.imageUrls[0]}" alt="Product image">
            </div>
            <button class="carousel-btn right">&#10095;</button>
          </div>
          <div class="dot-indicators" id="dots-${uid}"></div>
          <div class="thumbnail-container">
          <div class="thumbnail-strip" id="thumbs-${uid}"></div>
          </div>
        </div>

        <!-- Right: Product Info -->
        <div class="product-info-column">
          <h2>${p.title}</h2>
          <p class="product-price">₹${p.price}</p>
          <p class="product-description">${p.description}</p>
          <p><strong>Contact:</strong> ${p.contact}</p>
          <p><strong>Posted by:</strong> ${p.postedBy.name}</p>
          <p class="timestamp-label">🕒 ${new Date(p.timestamp).toLocaleString()}</p>

          <h3>Contact Seller</h3>
          ${
            isSeller
              ? `<p class="quote">You are the seller of this post.</p>`
              : `<button class="contact-seller-btn" onclick="startPrivateChat('${p.id}', '${p.title}', '${p.postedBy.userId}')">💬 Chat with Seller</button>`
          }

          <div class="share-section">
            <button id="shareBtn" class="share-btn">🔗 Share</button>
            <span id="shareMsg" class="share-msg"></span>
          </div>
        </div>
      </div>

      <!-- Fullscreen Modal -->
      <div class="fullscreen-modal" id="fullscreen-${uid}">
        <button class="close-btn">✖</button>
        <img id="fullscreenImage-${uid}" src="${p.imageUrls[0]}">
      </div>
      </div>
    `;

    // Carousel logic
    let index = 0;
    const imageEl = document.getElementById(`productImage-${uid}`);
    const fullscreenModal = document.getElementById(`fullscreen-${uid}`);
    const fullscreenImg = document.getElementById(`fullscreenImage-${uid}`);
    const dots = document.getElementById(`dots-${uid}`);
    const thumbs = document.getElementById(`thumbs-${uid}`);
    const carousel = document.getElementById(`carousel-${uid}`);

    const updateImage = () => {
        imageEl.classList.remove("fade-slide");
        void imageEl.offsetWidth;
        imageEl.classList.add("fade-slide");
        imageEl.src = p.imageUrls[index];
        fullscreenImg.src = p.imageUrls[index];
        renderDots();
        renderThumbs();
    };

    const renderDots = () => {
        dots.innerHTML = "";
        p.imageUrls.forEach((_, i) => {
            const dot = document.createElement("span");
            dot.className = "dot" + (i === index ? " active" : "");
            dot.onclick = () => {
                index = i;
                updateImage();
            };
            dots.appendChild(dot);
        });
    };

    const renderThumbs = () => {
        thumbs.innerHTML = "";
        p.imageUrls.forEach((url, i) => {
            const thumb = document.createElement("img");
            thumb.src = url;
            thumb.className = "thumbnail" + (i === index ? " active" : "");
            thumb.onclick = () => {
                index = i;
                updateImage();
            };
            thumbs.appendChild(thumb);
        });
    };

    carousel.querySelector(".left").onclick = () => {
        index = (index - 1 + p.imageUrls.length) % p.imageUrls.length;
        updateImage();
    };

    carousel.querySelector(".right").onclick = () => {
        index = (index + 1) % p.imageUrls.length;
        updateImage();
    };

    imageEl.onclick = () => fullscreenModal.classList.add("active");
    fullscreenModal.querySelector(".close-btn").onclick = () => fullscreenModal.classList.remove("active");

    updateImage();

    // ✅ Share Button Setup
    const shareBtn = document.getElementById("shareBtn");
    const shareMsg = document.getElementById("shareMsg");
    const productUrl = `${location.origin}#product-${p.id}`;

    if (navigator.share) {
        shareBtn.onclick = () => {
            navigator.share({
                title: p.title,
                text: "Check out this product on SRM Market:",
                url: productUrl
            }).catch(err => {
                console.warn("Share cancelled:", err);
            });
        };
    } else {
        shareBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(productUrl);
                shareMsg.textContent = "🔗 Link copied!";
                setTimeout(() => (shareMsg.textContent = ""), 2000);
            } catch (err) {
                shareMsg.textContent = "⚠️ Failed to copy";
            }
        };
    }
}

function loadProductById(productId) {
    const container = document.getElementById("productDetails");
    container.innerHTML = "<p class='loading-text'>🔄 Loading product...</p>";

    db.collection("posts").doc(productId).get().then(doc => {
        if (doc.exists) {
            const product = doc.data();
            product.id = doc.id;
            showProductDetails(product);
        } else {
            container.innerHTML = "<p>❌ Product not found.</p>";
            lastLoadedProductId = null;
        }
    }).catch(error => {
        console.error("⚠️ Firestore error:", error);
        container.innerHTML = "<p>⚠️ Error loading product.</p>";
        lastLoadedProductId = null;
    }).finally(() => {
        isProductLoading = false; // 🔓 unlock
    });
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
async function renderPrivateInbox() {
    const list = document.getElementById("messagesList");
    const userId = firebase.auth().currentUser?.uid;

    if (!userId) {
        list.innerHTML = "<p>⚠️ Not logged in.</p>";
        return;
    }

    list.innerHTML = "Loading...";

    try {
        const snapshot = await db.collection("inbox_summary")
            .where("userId", "==", userId)
            .orderBy("timestamp", "desc")
            .get();

        if (snapshot.empty) {
            list.innerHTML = "<p>No private messages yet.</p>";
            return;
        }

        list.innerHTML = "";
        let totalUnread = 0;

        snapshot.forEach(doc => {
            const t = doc.data();
            totalUnread += t.unreadCount || 0;

            const card = document.createElement("div");
            card.className = "card";
            card.innerHTML = `
                <p><strong>${t.productTitle}</strong></p>
                <p><strong>${t.otherUserName || "User"}</strong>: ${t.lastMessage ? t.lastMessage.slice(0, 40) : "(No message)"}</p>
                ${t.unreadCount > 0 ? `<p>🔔 ${t.unreadCount} unread</p>` : ""}
                <button onclick="openPrivateChat('${t.productId}', '${t.productTitle}', '${t.otherUserId}')">Open Thread</button>
            `;
            list.appendChild(card);
        });

        // ✅ Badge update
        const badge = document.querySelector(".nav-messages-btn .msg-badge");
        if (badge) {
            badge.textContent = totalUnread > 0 ? totalUnread : "";
            badge.classList.toggle("hidden", totalUnread === 0);
        }

    } catch (err) {
        console.error("❌ Failed to load inbox summary:", err);
        list.innerHTML = "<p>❌ Failed to load messages. Try again later.</p>";
    }
}


// Open Real-time Chat
async function renderMyPosts() {
    const grid = document.getElementById("myGrid");
    const userId = firebase.auth().currentUser?.uid;

    if (!userId || !grid) return;

    grid.innerHTML = "Loading...";

    try {
        trackedRead("📤 renderMyPosts: fetching user's posts");

        const postSnap = await db.collection("posts")
            .where("postedBy.userId", "==", userId)
            .get();

        // ✅ If no posts found
        if (postSnap.empty) {
            grid.innerHTML = `
                <div class="empty-state">
                    <p>🪹 You haven't posted anything yet.</p>
                    <button onclick="showSection('newPost')">➕ Create Your First Post</button>
                </div>
            `;
            return;
        }

        // ✅ Clear previous content
        grid.innerHTML = "";

        postSnap.forEach(doc => {
            const p = doc.data();
            const unread = p.unreadCount || 0; // optional badge

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

    } catch (err) {
        console.error("❌ Failed to render posts:", err);
        grid.innerHTML = "<p>❌ Error loading your posts. Please try again later.</p>";
    }
}


let isInChatView = false;

function openChatThread(productId, productTitle = "", markAsSeen = false) {
    showSection("chatThread");
    isInChatView = true;

    setTimeout(() => {
        currentThread = productId;
        currentTitle = productTitle;

        const userId = firebase.auth().currentUser?.uid;
        const titleEl = document.getElementById("chatProductTitle");
        const chat = document.getElementById("chatMessages");

        if (!titleEl || !chat) {
            console.warn("⚠️ Chat DOM not ready. Retrying...");
            return requestAnimationFrame(() => openChatThread(productId, productTitle, markAsSeen));
        }

        titleEl.textContent = productTitle;
        chat.innerHTML = "Loading...";

        // ✅ Declare threadId and query here
        let threadId = null;
        let query = db.collection("messages");

        if (chatMode === "private") {
            if (!chatRecipientId || userId === chatRecipientId) {
                alert("❌ Cannot open private chat with yourself.");
                showSection("messages");
                return;
            }

            threadId = getThreadId(userId, chatRecipientId, productId);
            query = query.where("threadId", "==", threadId).where("type", "==", "private");

            // ✅ Reset unread count for this private thread
            (async () => {
                try {
                    const batch = db.batch();

                    // Reset thread-level summary
                    const threadRef = db.collection("inbox_summary").doc(`${userId}_${chatRecipientId}_${productId}`);
                    batch.set(threadRef, {
                        unreadCount: 0
                    }, {
                        merge: true
                    });

                    // Reset global unread count
                    const globalRef = db.collection("inbox_summary").doc(userId);
                    batch.set(globalRef, {
                        unreadCount: 0
                    }, {
                        merge: true
                    });

                    await batch.commit();
                    console.log("✅ Thread and global unread count reset.");
                } catch (err) {
                    console.warn("📭 Failed to reset unread count:", err);
                }
            })();

        } else {
            query = query.where("productId", "==", productId).where("type", "==", "public");
        }

        let statusEl = document.getElementById("chatStatusIndicator");
        if (!statusEl) {
            statusEl = document.createElement("div");
            statusEl.id = "chatStatusIndicator";
            statusEl.style.fontSize = "0.85rem";
            statusEl.style.color = "#555";
            document.querySelector(".chat-header").appendChild(statusEl);
        }

        if (chatMode === "private" && chatRecipientId) {
            trackedRead("📡 Live snapshot: chat thread or inbox");

            db.collection("users").doc(chatRecipientId).onSnapshot(doc => {
                const data = doc.data();
                if (!data?.lastSeen) return;

                const now = Date.now();
                const delta = now - data.lastSeen;

                const status = delta < 60000 ?
                    "🟢 Online" :
                    `Last seen at ${new Date(data.lastSeen).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                    })}`;
                statusEl.textContent = status;
            });
        }

        if (unsubscribeChatListener) {
            unsubscribeChatListener();
            unsubscribeChatListener = null;
        }

        const badge = document.querySelector(".nav-messages-btn .msg-badge");
        if (badge) {
            badge.textContent = "";
            badge.classList.add("hidden");
        }

        // ✅ Load newest messages first
        query = query.orderBy("timestamp", "desc");

        trackedRead("📡 Live snapshot: chat thread or inbox");

        console.log("Setting up chat listener")
        unsubscribeChatListener = query.onSnapshot(snapshot => {
            chat.innerHTML = "";
            const scrollBtn = document.getElementById("scrollToBottomBtn");

            const seenUpdateRefs = [];
            const deliveredUpdateRefs = [];

            const docs = [...snapshot.docs].reverse(); // reverse to show top-to-bottom

            if (snapshot.empty) {
                chat.innerHTML = "<p style='padding: 1rem;'>No messages yet.</p>";
                return;
            }

            docs.forEach(doc => {
                const msg = doc.data();
                const docRef = doc.ref;

                const isMe = msg.fromUserId === userId;
                const isToMe = msg.toUserId === userId || msg.type === "public";
                const notSeen = !msg.seenBy || !msg.seenBy.includes(userId);
                const notDelivered = msg.toUserId === userId && !msg.delivered;

                if (isToMe && notSeen && isInChatView) {
                    seenUpdateRefs.push(docRef);
                }

                if (notDelivered) {
                    deliveredUpdateRefs.push(docRef);
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

                const content = isHtmlSafe(msg.message) ?
                    msg.message :
                    `<p>${msg.message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;

                bubble.innerHTML = `
                    ${!isMe ? `<div class="chat-avatar">${msg.fromName?.charAt(0).toUpperCase()}</div><strong>${msg.fromName}</strong><br>` : ""}
                    ${content}
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

                chat.appendChild(bubble); // ✅ append in correct visual order
            });

            // ✅ Save the oldest message (top of list) for pagination
            lastVisibleMessage = snapshot.docs[snapshot.docs.length - 1];

            const loadMoreBtn = document.getElementById("loadOlderBtn");
            if (snapshot.size < CHAT_PAGE_SIZE) {
                loadMoreBtn?.classList.add("hidden");
            } else {
                loadMoreBtn?.classList.remove("hidden");
            }

            // ✅ Seen + Delivered updates
            setTimeout(() => {
                if (!seenUpdateRefs.length && !deliveredUpdateRefs.length) return;

                const batch = db.batch();

                seenUpdateRefs.forEach(ref => {
                    batch.update(ref, {
                        seenBy: firebase.firestore.FieldValue.arrayUnion(userId)
                    });
                });

                deliveredUpdateRefs.forEach(ref => {
                    batch.update(ref, {
                        delivered: true
                    });
                });

                batch.commit()
                    .then(() => {
                        if (seenUpdateRefs.length) playNotifSound();
                        if (typeof window.fetchUnreadCount === "function") {
                            window.fetchUnreadCount();
                        }
                    })
                    .catch(err => {
                        console.error("❌ Failed batch update:", err);
                    });
            }, 300);

            // ✅ Scroll to bottom on initial load
            chat.scrollTop = chat.scrollHeight;

            if (chat.scrollHeight - chat.scrollTop > chat.clientHeight + 100) {
                scrollBtn?.classList.remove("hidden");
            } else {
                scrollBtn?.classList.add("hidden");
            }
        });
    }, 0);
}

async function markThreadMessagesAsSeen(query, userId) {
    console.log(" resetUnreadCount() CALLED", {
        userId,
        productId,

        otherUserId
    });
    if (!isInChatView) return;

    try {
        const snapshot = await query.get();
        const batch = db.batch();

        snapshot.forEach(doc => {
            const msg = doc.data();
            const docRef = doc.ref;

            const isToMe = msg.toUserId === userId;
            const notSeen = !msg.seenBy || !msg.seenBy.includes(userId);

            if (isToMe && notSeen) {
                batch.update(docRef, {
                    seenBy: firebase.firestore.FieldValue.arrayUnion(userId)
                });
            }
        });

        await batch.commit();

        // ✅ Reset unread count in summary
        if (typeof resetUnreadCount === "function") {
            await resetUnreadCount(userId, currentThread, chatRecipientId);
        }

        // ✅ Refresh the badge
        if (typeof window.fetchUnreadCount === "function") {
            window.fetchUnreadCount();
        }

    } catch (err) {
        console.error("❌ Failed to mark messages as seen:", err);
    }
}

async function resetUnreadCount(userId, productId, otherUserId) {
    const docId = `${userId}_${otherUserId}_${productId}`;
    const ref = db.collection("inbox_summary").doc(docId);

    try {
        await ref.update({
            unreadCount: 0
        });
        console.log("✅ unreadCount reset for:", docId);
    } catch (err) {
        console.warn("⚠️ Failed to reset unreadCount:", err);
    }
}


function openPrivateChat(productId, productTitle, buyerId) {
    chatMode = "private";
    chatRecipientId = buyerId;
    openChatThread(productId, productTitle, true); // markAsSeen = true
}

function startPrivateChat(productId, productTitle, sellerId) {
    const userId = firebase.auth().currentUser?.uid;

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
    const sendBtn = document.querySelector(".chat-input-box button:last-child");
    sendBtn.disabled = true;

    const replyInput = document.getElementById("replyText");
    const msgText = replyInput.value.trim();
    if (!msgText) {
        sendBtn.disabled = false;
        return;
    }

    const userId = firebase.auth().currentUser?.uid;
    const user = currentUser || {};
    const name = user.name?.trim();
    const phone = user.phone?.trim();

    if (!name || !/^[0-9]{7,15}$/.test(phone)) {
        alert("Your profile is incomplete.");
        sendBtn.disabled = false;
        return;
    }

    const timestamp = Date.now();
    const threadId = getThreadId(userId, chatRecipientId, currentThread);

    const msgData = {
        type: chatMode,
        productId: currentThread,
        productTitle: currentTitle,
        fromUserId: userId,
        fromName: name,
        phone,
        message: msgText,
        timestamp,
        seenBy: [],
        delivered: false,
        threadId
    };

    if (chatMode === "private") {
        msgData.toUserId = chatRecipientId;
    }

    try {
        await db.collection("messages").add(msgData);

        let recipientName = "User";
        try {
            const userSnap = await db.collection("users").doc(chatRecipientId).get();
            if (userSnap.exists) {
                recipientName = userSnap.data().name || "User";
            }
        } catch (e) {
            console.warn("⚠️ Failed to fetch recipient name:", e);
        }

        // ✅ Sender summary
        const senderRef = db.collection("inbox_summary").doc(`${userId}_${chatRecipientId}_${currentThread}`);
        const senderData = {
            userId,
            otherUserId: chatRecipientId,
            otherUserName: recipientName,
            productId: currentThread,
            productTitle: currentTitle,
            lastMessage: msgText,
            timestamp,
            unreadCount: 0
        };

        // ✅ Recipient summary
        const recipientRef = db.collection("inbox_summary").doc(`${chatRecipientId}_${userId}_${currentThread}`);
        const recipientData = {
            userId: chatRecipientId,
            otherUserId: userId,
            otherUserName: currentUser.name,
            productId: currentThread,
            productTitle: currentTitle,
            lastMessage: msgText,
            timestamp,
            unreadCount: firebase.firestore.FieldValue.increment(1)
        };

        const batch = db.batch();
        batch.set(senderRef, senderData, {
            merge: true
        });
        batch.set(recipientRef, recipientData, {
            merge: true
        });
        await batch.commit();

        replyInput.value = ""; // ✅ Clear input

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

    const userId = firebase.auth().currentUser?.uid;
    const user = currentUser || {};
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

    if (currentThread) {
        openChatThread(currentThread, currentTitle);
    }
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
    if (!confirm("Are you sure you want to delete this post?")) return;

    db.collection("posts").doc(postId).delete()
        .then(() => {
            console.log("✅ Post deleted:", postId);
            renderMyPosts(); // 🔁 Re-render the post list
        })
        .catch(err => {
            console.error("❌ Failed to delete post:", err);
            alert("Failed to delete post. Please try again.");
        });
}


function disableTemporarily(btn, duration = 2000) {
    btn.disabled = true;
    setTimeout(() => btn.disabled = false, duration);
}


function setWelcomeMessage() {
    const welcomeSpan = document.getElementById("welcomeMsg");
    if (!welcomeSpan) return;

    const userId = firebase.auth().currentUser?.uid;
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

function showSignIn() {
    document.getElementById("signInForm").classList.remove("hidden");
    document.getElementById("signUpForm").classList.add("hidden");
}

function showSignUp() {
    document.getElementById("signUpForm").classList.remove("hidden");
    document.getElementById("signInForm").classList.add("hidden");
}

// 🟢 Sign Up Handler
document.getElementById("signUpForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const loader = document.getElementById("authLoader");
    loader.classList.remove("hidden"); // Show loader

    const form = e.target;
    const submitBtn = form.querySelector("button[type='submit']");
    submitBtn.disabled = true;

    const name = document.getElementById("signUpName").value.trim();
    const phone = document.getElementById("signUpPhone").value.trim();
    const password = document.getElementById("signUpPassword").value;

    if (!name || name.length < 2) {
        showToast("Please enter a valid name.", "error");
        submitBtn.disabled = false;
        return;
    }

    if (!isValidIndianMobile(phone)) {
        showToast("Please enter a valid Indian mobile number.", "error");
        submitBtn.disabled = false;
        return;
    }

    if (password.length < 6) {
        showToast("Password must be at least 6 characters long.", "error");
        submitBtn.disabled = false;
        return;
    }

    try {
        const email = `${phone}@buyorsell.com`;
        const userCred = await firebase.auth().createUserWithEmailAndPassword(email, password);
        const userId = userCred.user.uid;

        await db.collection("users").doc(userId).set({
            name,
            phone
        });

        showToast("✅ Account created!", "success");
        initProductForm();
        loadProfileView();
        showSection("profile");
    } catch (err) {
        console.error("❌ Firebase Sign Up Error:", err);

        const errorMap = {
            "auth/email-already-in-use": "An account already exists with this mobile number.",
            "auth/invalid-email": "Invalid mobile number format.",
            "auth/weak-password": "Password is too weak.",
            "auth/network-request-failed": "Network error. Try again.",
        };

        const msg = errorMap[err.code] || "Sign up failed. Please try again.";
        showToast(msg, "error");
    } finally {
        submitBtn.disabled = false;

        loader.classList.add("hidden");
    }
});

// 🔵 Sign In Handler
document.getElementById("signInForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const loader = document.getElementById("authLoader");
    loader.classList.remove("hidden");
    const phone = document.getElementById("signInPhone").value.trim();
    const password = document.getElementById("signInPassword").value;

    try {
        const email = mobileToEmail(phone);
        await firebase.auth().signInWithEmailAndPassword(email, password);

        // Wait a bit to ensure onAuthStateChanged triggers
        setTimeout(() => {
            loadProfileView(); // 🧠 Load user's profile after login
            showSection("profile"); // ✅ Redirect to profile section
        }, 500); // short delay for auth state to sync

        showToast("✅ Signed in!", "success");

    } catch (err) {
        console.error("❌ Firebase Auth Error:", err);

        const errorMap = {
            "auth/invalid-email": "Invalid mobile number format.",
            "auth/user-not-found": "No account found with that mobile number.",
            "auth/wrong-password": "Incorrect password. Please try again.",
            "auth/too-many-requests": "Too many attempts. Try again later.",
            "auth/network-request-failed": "Network error. Check your connection.",
        };

        const msg = errorMap[err.code] || "Login failed. Please check your credentials.";
        showToast(msg, "error");

    } finally {
        loader.classList.add("hidden");
    }
});

// 🚪 Updated logout function
function logoutProfile() {
    firebase.auth().signOut().then(() => {
        localStorage.removeItem("userProfile");
        alert("Logged out.");
        location.reload();
    });

}

function createProfileButton(label, onClick) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
}

async function loadProfileView() {
    const nameEl = document.getElementById("profileName");
    const phoneEl = document.getElementById("profilePhone");
    const btnContainer = document.getElementById("profileButtons");

    nameEl.textContent = "Anonymous";
    phoneEl.textContent = "Anonymous";

    const newContainer = btnContainer.cloneNode(false);
    btnContainer.replaceWith(newContainer);

    const user = firebase.auth().currentUser;

    // 🛑 If user is NOT logged in → show Sign In / Sign Up
    if (!user) {
        newContainer.appendChild(createProfileButton("Sign In", () => showSection("authSection")));
        newContainer.appendChild(createProfileButton("Sign Up", () => {
            showSection("authSection");
            showSignUp();
        }));
        return;
    }

    // ✅ Logged in: Try local cache first
    const cached = localStorage.getItem("userProfile");
    if (cached) {
        try {
            const {
                name = "Anonymous", phone = "Anonymous"
            } = JSON.parse(cached);
            nameEl.textContent = name.trim();
            phoneEl.textContent = phone.trim();
        } catch (err) {
            console.warn("⚠️ Failed to parse userProfile cache");
        }
    } else {
        // 🧠 No cache → Fetch profile once
        try {
            trackedRead("👤 loadProfileView: getting user profile");

            const doc = await db.collection("users").doc(user.uid).get();
            const data = doc.data() || {};
            const {
                name = "Anonymous", phone = "Anonymous"
            } = data;

            nameEl.textContent = name.trim();
            phoneEl.textContent = phone.trim();

            // 💾 Save to cache
            localStorage.setItem("userProfile", JSON.stringify(data));
        } catch (err) {
            showToast("Failed to load profile.", "error");
            console.error(err);
        }
    }

    // ✅ Show logged-in buttons
    newContainer.appendChild(createProfileButton("Edit Profile", () => {
        loadProfileFields();
        showSection("editProfile");
    }));

    newContainer.appendChild(createProfileButton("Logout", logoutProfile));
}

// 📌 Auto-activate the first tab when profile section loads
window.addEventListener("DOMContentLoaded", () => {
    const firstTab = document.querySelector(".tab-nav button[data-tab]");
    if (firstTab) firstTab.click();
});


function isValidIndianMobile(phone) {
    return /^[6-9]\d{9}$/.test(phone); // starts with 6-9 and has exactly 10 digits
}

function restrictPhoneInput(id) {
    const input = document.getElementById(id);
    input.addEventListener("input", () => {
        input.value = input.value.replace(/\D/g, ""); // Remove non-digits
    });
}

function showToast(message, type = "error", duration = 3000) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = `toast show ${type}`;

    setTimeout(() => {
        toast.className = "toast hidden";
    }, duration);
}

const tabContentMap = {
    faq: `
        <ul>
            <li><strong>How do I post?</strong> Go to 'Post' and fill the form.</li>
            <li><strong>How do I edit profile?</strong> Click 'Edit Profile' button in profile section.</li>
            <li><strong>How do I delete a product?</strong> Go to 'My Posts' and click delete.</li>
        </ul>
    `,
    about: `
        <p>This platform is built by SRM students to help fellow SRMites buy and sell items safely and easily.</p>
    `,
    terms: `
        <p>By using this app, you agree to post only real, legal, and appropriate content. We reserve the right to remove violating posts.</p>
    `,
    privacy: `
        <p>Your name and mobile number are stored securely via Firebase and never shared. We value your privacy.</p>
    `
};

document.querySelectorAll(".tabs-container .tab button").forEach(button => {
    button.addEventListener("click", (e) => {
        const tabKey = e.currentTarget.closest(".tab").dataset.tab;
        toggleTabContent(tabKey);
    });
});

// 🆕 Tab click handler for redesigned horizontal layout
document.querySelectorAll(".tab-nav button").forEach(button => {
    button.addEventListener("click", () => {
        const tabId = button.dataset.tab;

        // Activate selected tab
        document.querySelectorAll(".tab-nav button").forEach(btn =>
            btn.classList.remove("active")
        );
        button.classList.add("active");

        // Toggle content visibility
        document.querySelectorAll(".tab-content").forEach(content =>
            content.classList.remove("show")
        );

        const target = document.getElementById(tabId);
        target.innerHTML = tabContentMap[tabId];
        target.classList.add("show");
    });
});


function initMarketCarousel() {
    let currentSlide = 0;
    const carousel = document.getElementById("market-carousel");
    const items = carousel.querySelectorAll(".carousel-item");

    function updateCarousel() {
        carousel.style.transform = `translateX(-${currentSlide * 100}%)`;
    }

    window.nextMarketSlide = function() {
        currentSlide = (currentSlide + 1) % items.length;
        updateCarousel();
    };

    window.prevMarketSlide = function() {
        currentSlide = (currentSlide - 1 + items.length) % items.length;
        updateCarousel();
    };

    // Optional: Auto-slide
    setInterval(() => {
        window.nextMarketSlide();
    }, 5000);
}

function isHtmlSafe(msg) {
    return msg.includes("<img") || msg.includes("<div") || msg.includes("<a");
}

function startLastSeenUpdater() {
    updateLastSeen(); // ✅ first call immediately

    // Update every 30 seconds
    setInterval(updateLastSeen, 30000);

    // Update when user switches tab/focuses back
    window.addEventListener("focus", updateLastSeen);
}

function updateLastSeen() {
    const userId = firebase.auth().currentUser?.uid;
    if (!userId) return;

    db.collection("users").doc(userId).update({
        lastSeen: Date.now()
    }).catch(console.error);
}

function startChatSnapshot(productId, userId, markAsSeen) {
    if (unsubscribeChatListener) {
        unsubscribeChatListener();
        unsubscribeChatListener = null;
    }

    let query = db.collection("messages");
    let threadId = null;

    if (chatMode === "private") {
        threadId = getThreadId(userId, chatRecipientId, productId);
        query = query.where("threadId", "==", threadId).where("type", "==", "private");
    } else {
        query = query.where("productId", "==", productId).where("type", "==", "public");
    }

    query = query.orderBy("timestamp");

    trackedRead("📡 Live snapshot: chat thread or inbox");

    unsubscribeChatListener = query.onSnapshot(snapshot => {
        const chat = document.getElementById("chatMessages");
        if (!chat) return;

        chat.innerHTML = "";
        const scrollBtn = document.getElementById("scrollToBottomBtn");

        snapshot.forEach(doc => {
            // render each message
            // (no need to mark seen here, we do that at the end)
        });

        markThreadMessagesAsSeen(query, userId);

        chat.scrollTop = chat.scrollHeight;
    });
}

document.getElementById("loadMoreBtn")?.addEventListener("click", () => {
    if (!isLoadingMore) {
        isLoadingMore = true;
        renderMarket(false).then(() => {
            isLoadingMore = false;
        });
    }
});
const menuBtn = document.getElementById("menuBtn");
const dropdown = document.querySelector(".menuDropdown");

let dropdownOpen = false;

if (menuBtn && dropdown) {
    // Toggle dropdown when button is clicked
    menuBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // Prevent outside click handler
        dropdownOpen = !dropdownOpen;
        dropdown.classList.toggle("hidden", !dropdownOpen);
        menuBtn.classList.toggle("active", dropdownOpen);
        menuBtn.setAttribute("aria-expanded", dropdownOpen.toString());
    });

    // Close dropdown on outside click
    document.addEventListener("click", () => {
        if (dropdownOpen) {
            dropdown.classList.add("hidden");
            menuBtn.classList.remove("active");
            menuBtn.setAttribute("aria-expanded", "false");
            dropdownOpen = false;
        }
    });

    // Close dropdown when clicking a menu item
    dropdown.addEventListener("click", (e) => {
        if (e.target.matches("button[data-nav]")) {
            // Add any custom navigation logic here if needed later
            dropdown.classList.add("hidden");
            menuBtn.classList.remove("active");
            menuBtn.setAttribute("aria-expanded", "false");
            dropdownOpen = false;
        }
    });
}
