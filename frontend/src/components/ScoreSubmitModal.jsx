import React, { useState, useEffect } from 'react';
import { submitScore } from '../api/scores';
import './ScoreSubmitModal.css';

export default function ScoreSubmitModal({ isOpen, game, system, onClose, onSubmitted, detectedScore }) {
  const [score, setScore] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen && detectedScore) {
      setScore(String(detectedScore));
    }
  }, [isOpen, detectedScore]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const scoreNum = parseInt(score, 10);
    if (Number.isNaN(scoreNum) || scoreNum < 0) {
      setError('Please enter a valid score');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitScore(game, system, scoreNum);
      setSuccess(true);
      setScore('');
      setTimeout(() => {
        onSubmitted?.();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="score-modal-overlay">
      <div className="score-modal">
        <h2>Submit Your Score</h2>
        {success ? (
          <div className="score-modal-success">
            <p>✓ Score submitted!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="score-modal-game">{game}</p>
            <input
              type="number"
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder="Enter your score"
              min="0"
              autoFocus
              disabled={isSubmitting}
            />
            {error && <p className="score-modal-error">{error}</p>}
            <div className="score-modal-actions">
              <button
                type="submit"
                disabled={isSubmitting || !score}
                className="score-modal-submit"
              >
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="score-modal-cancel"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
