// ============================================================
// Supabase Authentication Service
// ============================================================
// Handles user login, logout, session management and 
// role-based access control.
// ============================================================

import { supabase } from './supabaseClient';

// ============================================================
// SESSION
// ============================================================
export async function getCurrentSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        console.error('Error getting session:', error);
        return null;
    }
    return session;
}

export async function getCurrentUser() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
        console.error('Error getting user:', error);
        return null;
    }
    return user;
}

// ============================================================
// LOGIN / LOGOUT
// ============================================================
export async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        return { user: null, error: error.message };
    }

    return { user: data.user, error: null };
}

export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Error signing out:', error);
    return !error;
}

// ============================================================
// USER CREATION (Admin only)
// ============================================================
export async function createUser(email, password, fullName, role = 'logistics') {
    // Sign up the user via Supabase Auth
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { full_name: fullName }
        }
    });

    if (error) {
        return { user: null, error: error.message };
    }

    // Update the profile role if needed
    if (data.user && role !== 'logistics') {
        await supabase
            .from('user_profiles')
            .update({ role, full_name: fullName })
            .eq('id', data.user.id);
    }

    return { user: data.user, error: null };
}

// ============================================================
// PROFILE
// ============================================================
export async function getUserProfile(userId) {
    const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (error) {
        console.error('Error fetching profile:', error);
        return null;
    }
    return data;
}

export async function isAdmin(userId) {
    const profile = await getUserProfile(userId);
    return profile?.role === 'admin';
}

// ============================================================
// AUTH STATE LISTENER
// ============================================================
export function onAuthStateChange(callback) {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (event, session) => {
            callback(event, session);
        }
    );
    return subscription;
}

// ============================================================
// PASSWORD RECOVERY
// ============================================================

/**
 * Send a password reset email. The link will redirect to the
 * production app URL so it works from any device.
 */
export async function resetPasswordForEmail(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://hsconsultingtravelapp.netlify.app'
    });
    if (error) return { error: error.message };
    return { error: null };
}

/**
 * Update the authenticated user's password (called after recovery redirect).
 */
export async function updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: error.message };
    return { error: null };
}
