console.log('🚌 Bus Booking System - JavaScript loading...');

// Get DOM elements
const showsCardsEl = document.getElementById('shows-cards');
const showsLoadingEl = document.getElementById('shows-loading');
const filterDateEl = document.getElementById('filter-date');
const applyFilterBtn = document.getElementById('apply-filter');
const clearFilterBtn = document.getElementById('clear-filter');
const seatGridEl = document.getElementById('seat-grid');
const seatHeaderEl = document.getElementById('seat-header');
const seatmapShowIdEl = document.getElementById('seatmap-show-id');
const loadSeatsBtn = document.getElementById('load-seats');
const bookSelectedBtn = document.getElementById('book-selected');
const holdSelectedBtn = document.getElementById('hold-selected');
const bookingIdEl = document.getElementById('booking-id');
const bookingOutputEl = document.getElementById('booking-output');
const myBookingsListEl = document.getElementById('my-bookings-list');
const loadMyBookingsBtn = document.getElementById('load-my-bookings');
const toastEl = document.getElementById('toast');

// Login elements
const loginForm = document.getElementById('login-form');
const loginUsernameEl = document.getElementById('login-username');
const loginPasswordEl = document.getElementById('login-password');
const loginAdminBtn = document.getElementById('login-admin');
const loginUserBtn = document.getElementById('login-user');
const whoamiEl = document.getElementById('whoami');

let selectedSeats = new Set();
let currentShowId = null;

function formatTime(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { headers, ...options });
  const text = await res.text();
  try { return { ok: res.ok, data: text ? JSON.parse(text) : null }; }
  catch { return { ok: res.ok, data: text }; }
}

function setAuth({ token, role, username }) {
  if (token) localStorage.setItem('token', token);
  if (role) localStorage.setItem('role', role);
  if (username) localStorage.setItem('username', username);
  renderWhoAmI();
  updateSectionVisibility();
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  localStorage.removeItem('username');
  renderWhoAmI();
  updateSectionVisibility();
  showToast('Logged out successfully', 'success');
}

function isLoggedIn() {
  return !!localStorage.getItem('token');
}

function updateSectionVisibility() {
  const loggedIn = isLoggedIn();
  const role = localStorage.getItem('role');
  const isAdmin = role === 'admin';
  
  const loginSection = document.getElementById('login');
  const showsSection = document.getElementById('shows');
  const seatmapSection = document.getElementById('seatmap');
  const bookingSection = document.getElementById('booking');
  const adminSection = document.getElementById('admin');
  
  if (loginSection) loginSection.style.display = loggedIn ? 'none' : 'block';
  if (showsSection) showsSection.style.display = loggedIn ? 'block' : 'none';
  if (seatmapSection) seatmapSection.style.display = loggedIn ? 'block' : 'none';
  if (bookingSection) bookingSection.style.display = loggedIn ? 'block' : 'none';
  if (adminSection) adminSection.style.display = (loggedIn && isAdmin) ? 'block' : 'none';
}

function renderWhoAmI() {
  const role = localStorage.getItem('role');
  const username = localStorage.getItem('username');
  if (role && username) {
    whoamiEl.innerHTML = `Signed in as ${username} (${role}) <button type="button" onclick="logout()" class="secondary" style="margin-left: 8px; padding: 4px 8px; font-size: 12px;">Logout</button>`;
  } else {
    whoamiEl.textContent = 'Not signed in';
  }
}

function showToast(message, type = 'error', timeout = 3000) {
  toastEl.textContent = message;
  toastEl.className = `toast ${type} show`;
  setTimeout(() => toastEl.classList.remove('show'), timeout);
}

async function loadShows() {
  console.log('Loading shows...');
  showsLoadingEl.classList.remove('hidden');
  
  try {
    const dateQuery = filterDateEl.value ? `?date=${filterDateEl.value}` : '';
    const { ok, data } = await api(`/shows${dateQuery}`);
    console.log('Shows API response:', { ok, data });
    
    showsLoadingEl.classList.add('hidden');
    
    if (!ok) {
      showsCardsEl.innerHTML = '<div class="no-data">Failed to load buses. Please try again.</div>';
      return;
    }
    
    showsCardsEl.innerHTML = '';
    
    if (!data.shows || data.shows.length === 0) {
      showsCardsEl.innerHTML = '<div class="no-data">No buses available for the selected date.</div>';
      return;
    }
    
    data.shows.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'card-trip';
      const available = s.available_seats ?? 0;
      const total = s.total_seats ?? 0;
      const booked = s.booked_seats ?? (total - available);
      const pctBooked = total ? Math.round((booked / total) * 100) : 0;
      
      card.innerHTML = `
        <div class="trip-title">${s.name}</div>
        <div class="trip-meta">
          <div class="row">🕒 ${formatTime(s.start_time)}</div>
          <div class="row">💺 Available: ${available} <span class="badge">${total} seats</span></div>
        </div>
        <div class="progress"><div class="bar" style="width:${pctBooked}%"></div></div>
        <div class="trip-actions">
          <span class="hint">${pctBooked}% booked</span>
          <button onclick="selectShow(${s.id})">Book Now</button>
        </div>
      `;
      showsCardsEl.appendChild(card);
    });
    
    console.log(`Loaded ${data.shows.length} buses`);
  } catch (error) {
    console.error('Error loading buses:', error);
    showsLoadingEl.classList.add('hidden');
    showsCardsEl.innerHTML = '<div class="no-data">Error loading buses. Please refresh the page.</div>';
  }
}

function selectShow(showId) {
  seatmapShowIdEl.value = showId;
  loadSeatMap();
  window.location.hash = '#seatmap';
}

async function loadSeatMap() {
  const id = Number(seatmapShowIdEl.value);
  if (!Number.isInteger(id)) return;
  currentShowId = id;
  const { ok, data } = await api(`/shows/${id}/seats`);
  if (!ok) return;
  const counts = data.counts || { available: 0, booked: 0, held: 0 };
  seatHeaderEl.textContent = `${data.show.name} — Total ${data.show.total_seats} | Available ${counts.available} | Booked ${counts.booked} | Held ${counts.held}`;
  renderSeatGrid(data.seats);
}

function renderSeatGrid(seats) {
  seatGridEl.innerHTML = '';
  selectedSeats.clear();
  seats.forEach((seat) => {
    const btn = document.createElement('div');
    btn.className = `seat ${seat.status}`;
    btn.textContent = seat.seat_number;
    btn.dataset.seatNumber = seat.seat_number;
    if (seat.status === 'available') {
      btn.onclick = () => {
        const num = Number(btn.dataset.seatNumber);
        if (selectedSeats.has(num)) {
          selectedSeats.delete(num);
          btn.classList.remove('selected');
        } else {
          selectedSeats.add(num);
          btn.classList.add('selected');
        }
      };
    }
    seatGridEl.appendChild(btn);
  });
}

async function bookSelected() {
  if (!currentShowId || selectedSeats.size === 0) return;
  const seatNumbers = Array.from(selectedSeats);
  const { ok, data } = await api('/bookings', {
    method: 'POST',
    body: JSON.stringify({ showId: currentShowId, seatNumbers, mode: 'confirm' })
  });
  
  if (ok && data?.booking?.id) {
    bookingIdEl.value = data.booking.id;
    showToast(`Booking ${data.booking.status}`, data.booking.status === 'CONFIRMED' ? 'success' : 'error');
    loadMyBookings();
    loadSeatMap();
    loadShows();
  } else {
    showToast(data?.message || 'Booking failed', 'error');
  }
}

async function loadMyBookings() {
  if (!isLoggedIn()) {
    myBookingsListEl.innerHTML = '<div class="no-data">Please log in to view your bookings.</div>';
    return;
  }
  
  try {
    const { ok, data } = await api('/bookings');
    
    if (!ok) {
      myBookingsListEl.innerHTML = '<div class="no-data">Failed to load bookings. Please try again.</div>';
      return;
    }
    
    if (!data.bookings || data.bookings.length === 0) {
      myBookingsListEl.innerHTML = '<div class="no-data">You have no bookings yet.</div>';
      return;
    }
    
    myBookingsListEl.innerHTML = '';
    
    data.bookings.forEach(booking => {
      const bookingItem = document.createElement('div');
      bookingItem.className = 'booking-item';
      
      const statusClass = booking.status.toLowerCase();
      const seatText = booking.seat_count === 1 ? 'seat' : 'seats';
      
      bookingItem.innerHTML = `
        <div class="booking-header">
          <div class="booking-id">Booking #${booking.id}</div>
          <div class="booking-status ${statusClass}">${booking.status}</div>
        </div>
        <div class="booking-details">
          <div class="booking-trip">${booking.show_name}</div>
          <div>📅 ${formatTime(booking.start_time)}</div>
          <div>🕒 Booked: ${formatTime(booking.created_at)}</div>
          ${booking.seat_numbers ? `<div class="booking-seats">${booking.seat_count} ${seatText}: ${booking.seat_numbers}</div>` : ''}
        </div>
      `;
      
      myBookingsListEl.appendChild(bookingItem);
    });
    
  } catch (error) {
    console.error('Error loading bookings:', error);
    myBookingsListEl.innerHTML = '<div class="no-data">Error loading bookings. Please refresh the page.</div>';
  }
}

function setTodaysDate() {
  const today = new Date();
  const formattedDate = today.toISOString().split('T')[0];
  filterDateEl.value = formattedDate;
}

// Event listeners
loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = { username: loginUsernameEl.value.trim(), password: loginPasswordEl.value };
  const { ok, data } = await api('/auth/login', { method: 'POST', body: JSON.stringify(payload) });
  if (ok) {
    setAuth(data);
    showToast('Signed in', 'success');
    loadShows();
    loadMyBookings();
  } else {
    showToast(data?.error || 'Login failed', 'error');
  }
});

loginAdminBtn?.addEventListener('click', () => {
  loginUsernameEl.value = 'admin';
  loginPasswordEl.value = 'admin123';
});

loginUserBtn?.addEventListener('click', () => {
  loginUsernameEl.value = 'user';
  loginPasswordEl.value = 'user123';
});

applyFilterBtn?.addEventListener('click', loadShows);
clearFilterBtn?.addEventListener('click', () => { filterDateEl.value = ''; loadShows(); });
loadSeatsBtn?.addEventListener('click', loadSeatMap);
bookSelectedBtn?.addEventListener('click', bookSelected);
loadMyBookingsBtn?.addEventListener('click', loadMyBookings);

// Make functions global
window.logout = logout;
window.selectShow = selectShow;

// Initialize
console.log('Initializing app...');
setTodaysDate();
renderWhoAmI();
updateSectionVisibility();
loadShows();

if (isLoggedIn()) {
  loadMyBookings();
}

console.log('🚌 Bus Booking System initialized successfully!');
