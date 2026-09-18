const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Otp = require('../models/Otp');
const jwt = require('jsonwebtoken');
const { protect } = require('../middlewares/authMiddleware');
const { sendOtpEmail } = require('../utils/brevoMailer');
const { audit } = require('../utils/auditLogger');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1d' });
};

// @route   POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (user && (await user.comparePassword(password))) {
      audit('LOGIN_SUCCESS', {
        message: `${user.name} (${user.role}) logged in`,
        user: { id: user._id, name: user.name, role: user.role },
        req
      });
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        branch: user.branch,
        requiresPasswordChange: user.requiresPasswordChange,
        lastBackupAt: user.lastBackupAt || null,
        token: generateToken(user._id),
      });
    } else {
      audit('LOGIN_FAILED', {
        message: `Failed login attempt for email: ${email}`,
        user: { name: email, role: 'UNKNOWN' },
        req
      });
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// @route   PUT /api/auth/change-password
// @desc    Change password (used for initial login or forgotten)
router.put('/change-password', protect, async (req, res) => {
  try {
    const { newPassword } = req.body;
    const user = await User.findById(req.user._id);

    if (user) {
      user.password = newPassword;
      user.requiresPasswordChange = false;
      await user.save();
      audit('PASSWORD_CHANGED', {
        message: `${user.name} changed their password`,
        req,
        target: { model: 'User', documentId: user._id.toString(), identifier: user.email }
      });
      res.json({ message: 'Password updated successfully' });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});
// @route   PUT /api/auth/update-profile
// @desc    Update email or password using current password authentication
router.put('/update-profile', protect, async (req, res) => {
  try {
    const { currentPassword, newEmail, newPassword } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ message: 'Incorrect current password' });
    }

    if (newEmail) {
      user.email = newEmail;
    }
    
    if (newPassword) {
      user.password = newPassword;
    }

    await user.save();
    res.json({ message: 'Profile updated successfully', email: user.email });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
});


// @route   POST /api/auth/request-otp
// @desc    Send a 6-digit OTP to the user's registered email
router.post('/request-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required.' });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'No account found with that email.' });

    // Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Upsert: overwrite any existing OTP for this email
    await Otp.findOneAndUpdate(
      { email },
      { email, code, createdAt: new Date() },
      { upsert: true, new: true }
    );

    // Send OTP via Brevo
    await sendOtpEmail(user.email, user.name, code);

    res.json({ message: 'OTP sent to your email. It expires in 5 minutes.' });
  } catch (err) {
    console.error('OTP request error:', err);
    res.status(500).json({ message: 'Failed to send OTP. Please try again.' });
  }
});

// @route   POST /api/auth/verify-otp
// @desc    Verify OTP and log the user in directly
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required.' });

    const record = await Otp.findOne({ email, code: otp });
    if (!record) return res.status(401).json({ message: 'Invalid or expired OTP.' });

    // OTP is valid — delete it so it can't be reused
    await Otp.deleteOne({ _id: record._id });

    // Find user and issue JWT (direct login, no password reset)
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found.' });

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      branch: user.branch,
      requiresPasswordChange: false,
      token: generateToken(user._id),
    });
  } catch (err) {
    console.error('OTP verify error:', err);
    res.status(500).json({ message: 'OTP verification failed.' });
  }
});

module.exports = router;
