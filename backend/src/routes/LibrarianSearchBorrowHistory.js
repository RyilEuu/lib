const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// 按姓名查询借阅历史
router.get('/by-name', async (req, res) => {
  try {
    const { name } = req.query;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: '姓名不能为空' 
      });
    }

    console.log(`查询用户: ${name}`);

    const user = await prisma.user.findFirst({
      where: { 
        name: name.trim()  // 移除 mode: 'insensitive'
      },
      include: {
        loans: {
          orderBy: { checkoutDate: 'desc' },
          include: {
            copy: {
              include: {
                book: true
              }
            }
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: '未找到该用户' 
      });
    }

    const borrowHistory = user.loans.map(loan => {
      let status = 'borrowed';
      const now = new Date();
      const dueDate = new Date(loan.dueDate);
      
      if (loan.returnDate) {
        status = 'returned';
      } else if (dueDate < now) {
        status = 'overdue';
      }
      
      return {
        id: loan.id,
        bookName: loan.copy.book.title,
        bookCode: loan.copy.barcode,
        borrowDate: loan.checkoutDate,
        dueDate: loan.dueDate,
        returnDate: loan.returnDate,
        status: status
      };
    });

    const currentBorrowCount = user.loans.filter(loan => !loan.returnDate).length;

    res.json({
      success: true,
      userInfo: {
        id: user.id,
        name: user.name,
        studentId: user.studentId,
        email: user.email,
        role: user.role,
        currentBorrowCount
      },
      borrowHistory
    });
  } catch (error) {
    console.error('查询借阅历史失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误',
      error: error.message 
    });
  }
});

// 按学号查询借阅历史
router.get('/by-studentId', async (req, res) => {
  try {
    const { studentId } = req.query;
    
    if (!studentId || studentId.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: '学号不能为空' 
      });
    }

    console.log(`查询学号: ${studentId}`);

    const user = await prisma.user.findUnique({
      where: { 
        studentId: studentId.trim()
      },
      include: {
        loans: {
          orderBy: { checkoutDate: 'desc' },
          include: {
            copy: {
              include: {
                book: true
              }
            }
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: '未找到该用户' 
      });
    }

    const borrowHistory = user.loans.map(loan => {
      let status = 'borrowed';
      const now = new Date();
      const dueDate = new Date(loan.dueDate);
      
      if (loan.returnDate) {
        status = 'returned';
      } else if (dueDate < now) {
        status = 'overdue';
      }
      
      return {
        id: loan.id,
        bookName: loan.copy.book.title,
        bookCode: loan.copy.barcode,
        borrowDate: loan.checkoutDate,
        dueDate: loan.dueDate,
        returnDate: loan.returnDate,
        status: status
      };
    });

    const currentBorrowCount = user.loans.filter(loan => !loan.returnDate).length;

    res.json({
      success: true,
      userInfo: {
        id: user.id,
        name: user.name,
        studentId: user.studentId,
        email: user.email,
        role: user.role,
        currentBorrowCount
      },
      borrowHistory
    });
  } catch (error) {
    console.error('查询借阅历史失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误',
      error: error.message 
    });
  }
});

// 测试接口
router.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: '路由工作正常！',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;