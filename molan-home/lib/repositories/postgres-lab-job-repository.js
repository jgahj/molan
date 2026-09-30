'use strict';
class PostgresLabJobRepository {
  constructor(repository) {
    if (typeof repository?.saveLabJob !== 'function') throw new TypeError('Native PG lab methods are required');
    this.repository = repository;
  }
  async init({ recover = true, kind } = {}) { return recover ? this.recover({ kind }) : { recovered: 0 }; }
  async save(input) { return this.repository.saveLabJob(input); }
  async load(input) { return this.repository.loadLabJob(input); }
  async list(input) { return this.repository.listLabJobs(input); }
  async vote(input) { return this.repository.voteLabJob(input); }
  async referenceVotes(input) { return this.repository.listLabReferenceVotes(input); }
  async recordReferenceVote(input) { return this.repository.recordLabReferenceVote(input); }
  async recover(input = {}) { return this.repository.recoverLabJobs(input); }
}
module.exports = { PostgresLabJobRepository };
