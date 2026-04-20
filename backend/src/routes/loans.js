// routes/loans.js - 馆员借书给学生 (完善版)

const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// 配置
const LOAN_DURATION_DAYS = 30;

// ==================== 权限检查中间件 ====================
function checkLibrarianOrAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: '未认证' });
  }
  if (req.user.role !== 'LIBRARIAN' && req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: '权限不足，需要馆员或管理员权限' });
  }
  next();
}

// ==================== 辅助函数 ====================

async function calculateDueDate(checkoutDate) {
  const dueDate = new Date(checkoutDate);
  dueDate.setDate(dueDate.getDate() + LOAN_DURATION_DAYS);
  return dueDate;
}

// ==================== 馆员专用 API ====================

// 馆员搜索学生
router.get('/users/search', requireAuth, checkLibrarianOrAdmin, async (req, res) => {
  try {
    const keyword = (req.query.keyword || '').trim();
    if (!keyword) return res.status(400).json({ message: '请输入搜索关键词' });

    const students = await prisma.user.findMany({
      where: {
        role: 'STUDENT',
        OR: [
          { studentId: { contains: keyword } },
          { email: { contains: keyword } },
          { name: { contains: keyword } }
        ]
      },
      select: { id: true, name: true, email: true, studentId: true, role: true }
    });

    const usersWithStats = await Promise.all(students.map(async (student) => {
      const currentBorrowCount = await prisma.loan.count({ where: { userId: student.id, returnDate: null } });
      const overdueLoans = await prisma.loan.count({ where: { userId: student.id, returnDate: null, dueDate: { lt: new Date() } } });
      return { ...student, stats: { currentBorrowCount, hasOverdue: overdueLoans > 0 } };
    }));

    res.json({ success: true, users: usersWithStats });
  } catch (error) {
    console.error('Search students error:', error);
    res.status(500).json({ message: '搜索学生失败' });
  }
});

// 馆员搜索图书
router.get('/books/search', requireAuth, checkLibrarianOrAdmin, async (req, res) => {
  try {
    const keyword = (req.query.keyword || '').trim();
    if (!keyword) return res.status(400).json({ message: '请输入搜索关键词' });

    const books = await prisma.book.findMany({
      where: {
        OR: [
          { title: { contains: keyword } },
          { isbn: { contains: keyword } },
          { author: { contains: keyword } }
        ]
      },
      include: { copies: { select: { id: true, barcode: true, status: true } } }
    });

    const booksWithAvailability = books.map(book => {
      const availableCopies = book.copies.filter(c => c.status === 'AVAILABLE').length;
      return { id: book.id, title: book.title, author: book.author, isbn: book.isbn, genre: book.genre, availableCopies, totalCopies: book.copies.length };
    });

    res.json({ success: true, books: booksWithAvailability });
  } catch (error) {
    console.error('Search books error:', error);
    res.status(500).json({ message: '搜索图书失败' });
  }
});

// 馆员借书给学生 (R1.1.12)
router.post('/lend', requireAuth, checkLibrarianOrAdmin, async (req, res) => {
  try {
    const { userId, bookId } = req.body;
    if (!userId || !bookId) return res.status(400).json({ success: false, message: '请选择学生和图书' });

    const student = await prisma.user.findUnique({ where: { id: Number(userId) } });
    if (!student || student.role !== 'STUDENT') return res.status(404).json({ success: false, message: '学生不存在' });

    const book = await prisma.book.findUnique({ where: { id: Number(bookId) }, include: { copies: { where: { status: 'AVAILABLE' }, take: 1 } } });
    if (!book) return res.status(404).json({ success: false, message: '图书不存在' });
    if (book.copies.length === 0) return res.status(400).json({ success: false, message: '该图书没有可用副本' });

    const existingLoan = await prisma.loan.findFirst({ where: { userId: Number(userId), copy: { bookId: Number(bookId) }, returnDate: null } });
    if (existingLoan) return res.status(400).json({ success: false, message: '该学生已经借阅了这本书' });

    const selectedCopy = book.copies[0];
    const checkoutDate = new Date();
    const dueDate = await calculateDueDate(checkoutDate);

    const loan = await prisma.loan.create({
      data: { userId: Number(userId), copyId: selectedCopy.id, checkoutDate, dueDate, fineAmount: 0, finePaid: false, fineForgiven: false }
    });

    await prisma.copy.update({ where: { id: selectedCopy.id }, data: { status: 'BORROWED' } });

    res.status(201).json({ success: true, message: `借书成功！《${book.title}》已借给 ${student.name}`, loan: { id: loan.id, bookTitle: book.title, checkoutDate, dueDate } });
  } catch (error) {
    console.error('Lend book error:', error);
    res.status(500).json({ success: false, message: '借书失败' });
  }
});

// 获取当前在借记录
router.get('/records', requireAuth, checkLibrarianOrAdmin, async (req, res) => {
  try {
    const loans = await prisma.loan.findMany({
      where: { returnDate: null },
      include: { user: { select: { id: true, name: true, studentId: true } }, copy: { include: { book: { select: { id: true, title: true } } } } },
      orderBy: { checkoutDate: 'desc' }
    });
    const loansWithStatus = loans.map(loan => ({ ...loan, status: loan.dueDate < new Date() ? 'overdue' : 'active' }));
    res.json({ success: true, loans: loansWithStatus, stats: { total: loans.length, active: loansWithStatus.filter(l => l.status === 'active').length, overdue: loansWithStatus.filter(l => l.status === 'overdue').length } });
  } catch (error) {
    console.error('Fetch loan records error:', error);
    res.status(500).json({ message: '获取借阅记录失败' });
  }
});

// 馆员还书 (R1.1.13)
router.post('/return', requireAuth, checkLibrarianOrAdmin, async (req, res) => {
  try {
    const { loanId, waiveFine } = req.body;
    if (!loanId) return res.status(400).json({ success: false, message: '请选择要归还的借阅记录' });

    const loan = await prisma.loan.findUnique({ where: { id: Number(loanId) }, include: { copy: { include: { book: true } }, user: true } });
    if (!loan) return res.status(404).json({ success: false, message: '借阅记录不存在' });
    if (loan.returnDate) return res.status(400).json({ success: false, message: '该图书已经归还过了' });

    const returnDate = new Date();
    let fineAmount = 0;
    if (returnDate > loan.dueDate) fineAmount = Math.ceil((returnDate - loan.dueDate) / (1000 * 60 * 60 * 24)) * 0.5;
    const finalFine = waiveFine ? 0 : fineAmount;

    await prisma.loan.update({ where: { id: Number(loanId) }, data: { returnDate, fineAmount: finalFine, finePaid: finalFine === 0, fineForgiven: waiveFine && fineAmount > 0 } });
    await prisma.copy.update({ where: { id: loan.copyId }, data: { status: 'AVAILABLE' } });

    let message = `《${loan.copy.book.title}》已成功归还`;
    if (finalFine > 0) message += `，逾期罚款 ${finalFine} 元`;

    res.json({ success: true, message, fine: finalFine, returnDate });
  } catch (error) {
    console.error('Return book error:', error);
    res.status(500).json({ success: false, message: '还书失败' });
  }
});

// 学生获取自己的借阅记录
router.get('/me', requireAuth, async (req, res) => {
  try {
    const loans = await prisma.loan.findMany({ where: { userId: req.user.id }, include: { copy: { include: { book: { select: { id: true, title: true } } } } }, orderBy: { checkoutDate: 'desc' } });
    res.json({ success: true, loans });
  } catch (error) {
    res.status(500).json({ message: '获取借阅记录失败' });
  }
});

module.exports = router;