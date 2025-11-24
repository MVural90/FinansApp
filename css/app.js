/**
 * Personal Finance App - Core Logic
 */

const APP_KEY = 'finance_app_data_v2';

// Initial State
const initialState = {
    accounts: [], // { id, name, balance, interestRate, lastInterestDate }
    cards: [],    // { id, name, limit, currentDebt, cutoffDay }
    incomes: [],  // { id, accountId, amount, description, date }
    expenses: [], // { id, type, cardId, amount, description, date, installments: { count, current, type } }
    budgets: [],  // { id, type: 'income'|'expense', amount, description, day: number }
    budgetPayments: [] // { budgetId, monthStr, isPaid, paidDate }
};

// State Management
let state = { ...initialState };

// Load Data
function loadState() {
    const stored = localStorage.getItem(APP_KEY);
    if (stored) {
        state = JSON.parse(stored);
        if (!state.budgets) state.budgets = [];
        if (!state.budgetPayments) state.budgetPayments = []; // Ensure new array exists
        if (!state.cards) state.cards = [];
        state.cards.forEach(c => {
            if (c.cutoffDay === undefined) c.cutoffDay = 1;
        });
    } else {
        if (state.accounts.length === 0) {
            addAccount('Nakit / Cüzdan', 0, 0);
        }
    }
}

// Save Data
function saveState() {
    localStorage.setItem(APP_KEY, JSON.stringify(state));
    updateUI();
}

// Format Currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency: 'TRY'
    }).format(amount);
}

// Generate ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// --- ACCOUNT MANAGEMENT ---

function addAccount(name, balance, interestRate) {
    state.accounts.push({
        id: generateId(),
        name,
        balance: parseFloat(balance),
        interestRate: parseFloat(interestRate),
        lastInterestDate: new Date().toISOString().split('T')[0]
    });
    saveState();
}

function updateAccount(id, data) {
    const index = state.accounts.findIndex(a => a.id === id);
    if (index !== -1) {
        state.accounts[index] = { ...state.accounts[index], ...data };
        saveState();
    }
}

function deleteAccount(id) {
    state.accounts = state.accounts.filter(a => a.id !== id);
    saveState();
}

// --- CARD MANAGEMENT ---

function addCard(name, limit, cutoffDay, paymentDay) {
    state.cards.push({
        id: generateId(),
        name,
        limit: parseFloat(limit),
        currentDebt: 0,
        cutoffDay: parseInt(cutoffDay) || 1,
        paymentDay: parseInt(paymentDay) || null
    });
    saveState();
}

function updateCard(id, data) {
    const index = state.cards.findIndex(c => c.id === id);
    if (index !== -1) {
        state.cards[index] = { ...state.cards[index], ...data };
        saveState();
    }
}

function deleteCard(id) {
    state.cards = state.cards.filter(c => c.id !== id);
    saveState();
}

// --- INCOME MANAGEMENT ---

function addIncome(accountId, amount, description, date) {
    const incomeAmount = parseFloat(amount);
    state.incomes.push({
        id: generateId(),
        accountId,
        amount: incomeAmount,
        description,
        date
    });

    // Update Account Balance
    const account = state.accounts.find(a => a.id === accountId);
    if (account) {
        account.balance += incomeAmount;
    }

    saveState();
}

function deleteIncome(id) {
    const income = state.incomes.find(i => i.id === id);
    if (income) {
        // Revert Account Balance
        const account = state.accounts.find(a => a.id === income.accountId);
        if (account) {
            account.balance -= income.amount;
        }
        state.incomes = state.incomes.filter(i => i.id !== id);
        saveState();
    }
}

function updateIncome(id, newData) {
    deleteIncome(id);
    addIncome(newData.accountId, newData.amount, newData.description, newData.date);
}

// --- BUDGET MANAGEMENT ---

function addBudget(type, amount, description, day) {
    state.budgets.push({
        id: generateId(),
        type,     // 'income' | 'expense'
        amount: parseFloat(amount),
        description,
        day: parseInt(day) || 1
    });
    saveState();
}

function updateBudget(id, data) {
    const index = state.budgets.findIndex(b => b.id === id);
    if (index !== -1) {
        state.budgets[index] = { ...state.budgets[index], ...data };
        saveState();
    }
}

function deleteBudget(id) {
    state.budgets = state.budgets.filter(b => b.id !== id);
    // Also remove related payments
    state.budgetPayments = state.budgetPayments.filter(bp => bp.budgetId !== id);
    saveState();
}

function toggleBudgetPayment(budgetId, monthStr, isPaid) {
    const existingIndex = state.budgetPayments.findIndex(bp => bp.budgetId === budgetId && bp.monthStr === monthStr);

    if (existingIndex !== -1) {
        if (isPaid) {
            state.budgetPayments[existingIndex].isPaid = true;
            state.budgetPayments[existingIndex].paidDate = new Date().toISOString();
        } else {
            // If unchecking, remove the payment record or set to false
            state.budgetPayments.splice(existingIndex, 1);
        }
    } else if (isPaid) {
        state.budgetPayments.push({
            budgetId,
            monthStr,
            isPaid: true,
            paidDate: new Date().toISOString()
        });
    }
    saveState();
}

function getBudgetPaymentStatus(budgetId, monthStr) {
    return state.budgetPayments.find(bp => bp.budgetId === budgetId && bp.monthStr === monthStr);
}

// --- EXPENSE MANAGEMENT ---

function addExpense(type, cardId, amount, description, date, installments = 1, installmentType = 'total') {
    const numInstallments = parseInt(installments);
    let monthlyAmount = 0;
    let totalAmount = 0;

    // Cutoff & Payment Date Logic
    let effectiveDate = new Date(date);

    if (type === 'credit_card' && cardId) {
        const card = state.cards.find(c => c.id === cardId);
        if (card && card.cutoffDay) {
            const expenseDay = effectiveDate.getDate();
            const cutoffDay = card.cutoffDay;
            const paymentDay = card.paymentDay;

            // Determine Billing Cycle Month
            // If expense is after cutoff, it belongs to the NEXT billing cycle
            if (expenseDay > cutoffDay) {
                effectiveDate.setMonth(effectiveDate.getMonth() + 1);
            }

            // Determine Payment Month (Target Month)
            // If we have a payment day, we can be precise
            if (paymentDay) {
                // If Payment Day is smaller than Cutoff Day (e.g. Cutoff 25, Payment 5),
                // it means the payment is in the MONTH AFTER the cycle ends.
                if (paymentDay < cutoffDay) {
                    effectiveDate.setMonth(effectiveDate.getMonth() + 1);
                }
                // Set the specific payment day
                effectiveDate.setDate(paymentDay);
            } else {
                // Fallback if no payment day is set: 
                // If we already shifted month (because > cutoff), set to 1st.
                // If we didn't shift (because <= cutoff), keep original date? 
                // User wants "payment month". Without payment day, we assume:
                // > Cutoff -> Next Month
                // <= Cutoff -> Current Month
                if (expenseDay > cutoffDay) {
                    effectiveDate.setDate(1);
                }
            }
        }
    }
    const dateStr = effectiveDate.toISOString().split('T')[0];

    if (numInstallments > 1) {
        if (installmentType === 'total') {
            totalAmount = parseFloat(amount);
            monthlyAmount = totalAmount / numInstallments;
        } else {
            monthlyAmount = parseFloat(amount);
            totalAmount = monthlyAmount * numInstallments;
        }

        const baseDate = new Date(dateStr);

        if (type === 'credit_card' && cardId) {
            const card = state.cards.find(c => c.id === cardId);
            if (card) {
                card.currentDebt += totalAmount;
            }
        }

        for (let i = 0; i < numInstallments; i++) {
            const nextDate = new Date(baseDate);
            nextDate.setMonth(baseDate.getMonth() + i);

            state.expenses.push({
                id: generateId(),
                type,
                cardId,
                amount: monthlyAmount,
                description: `${description} (${i + 1}/${numInstallments})`,
                date: nextDate.toISOString().split('T')[0],
                installments: { count: numInstallments, current: i + 1, type: installmentType }
            });
        }
    } else {
        // Single Payment
        const expenseAmount = parseFloat(amount);
        state.expenses.push({
            id: generateId(),
            type,
            cardId,
            amount: expenseAmount,
            description,
            date: dateStr,
            installments: { count: 1, current: 1 }
        });

        if (type === 'credit_card' && cardId) {
            const card = state.cards.find(c => c.id === cardId);
            if (card) card.currentDebt += expenseAmount;
        }
    }

    saveState();
}

function deleteExpense(id) {
    const expense = state.expenses.find(e => e.id === id);
    if (expense) {
        if (expense.type === 'credit_card' && expense.cardId) {
            const card = state.cards.find(c => c.id === expense.cardId);
            if (card) {
                card.currentDebt -= expense.amount;
            }
        }
        state.expenses = state.expenses.filter(e => e.id !== id);
        saveState();
    }
}

function updateExpense(id, newData) {
    deleteExpense(id);
    addExpense(newData.type, newData.cardId, newData.amount, newData.description, newData.date, newData.installments, newData.installmentType);
}

// --- CALCULATIONS ---

function getMonthlyTotals(year, month) {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);

    const incomeTotal = state.incomes
        .filter(i => {
            const d = new Date(i.date);
            return d >= start && d <= end;
        })
        .reduce((sum, i) => sum + i.amount, 0);

    const expenseTotal = state.expenses
        .filter(e => {
            const d = new Date(e.date);
            return d >= start && d <= end;
        })
        .reduce((sum, e) => sum + e.amount, 0);

    return { income: incomeTotal, expense: expenseTotal };
}

function getTotalAssets() {
    return state.accounts.reduce((sum, a) => sum + a.balance, 0);
}

function getTotalDebt() {
    return state.cards.reduce((sum, c) => sum + c.currentDebt, 0);
}

function getNetWorth() {
    return getTotalAssets() - getTotalDebt();
}

// --- INTEREST ---

function calculateInterest() {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    state.accounts.forEach(account => {
        if (account.lastInterestDate && account.interestRate > 0) {
            const lastDate = new Date(account.lastInterestDate);
            const diffTime = Math.abs(today - lastDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays >= 1 && account.lastInterestDate !== todayStr) {
                if (account.balance > 0) {
                    const dailyRate = account.interestRate / 100;
                    const interest = account.balance * dailyRate * diffDays;
                    addIncome(account.id, interest, `${diffDays} Günlük Faiz (${account.name})`, todayStr);
                }
            }
        }
        account.lastInterestDate = todayStr;
    });

    saveState();
}

// --- INIT ---

document.addEventListener('DOMContentLoaded', () => {
    loadState();
    calculateInterest();
    if (typeof initPage === 'function') {
        initPage();
    }
});

function updateUI() {
    if (typeof render === 'function') {
        render();
    }
}

function resetData() {
    if (confirm('DİKKAT: Tüm verileriniz (hesaplar, kartlar, gelirler, giderler) SİLİNECEK ve uygulama fabrika ayarlarına dönecektir.\n\nOnaylıyor musunuz?')) {
        localStorage.removeItem(APP_KEY);
        location.reload();
    }
}
