import { describe, expect, it } from 'vitest';
import { robotsAllowProjects } from '../../src/sources/mostaql/mostaql.source.js';

describe('robots project path rules', () => {
  it('blocks project listings for the generic group', () => {
    expect(robotsAllowProjects('User-agent: *\nDisallow: /projects')).toBe(false);
  });
  it('prefers the longer allowed rule', () => {
    expect(robotsAllowProjects('User-agent: *\nDisallow: /\nAllow: /projects', '/projects')).toBe(true);
  });
  it('prefers the specific user agent group', () => {
    const robots = 'User-agent: *\nDisallow: /projects\n\nUser-agent: ProjectHunterBot\nAllow: /projects';
    expect(robotsAllowProjects(robots, '/projects', 'ProjectHunterBot/1.0')).toBe(true);
  });
  it('supports wildcard and end anchor', () => {
    expect(robotsAllowProjects('User-agent: *\nDisallow: /project/*/private$', '/project/123/private')).toBe(false);
    expect(robotsAllowProjects('User-agent: *\nDisallow: /project/*/private$', '/project/123/private/extra')).toBe(true);
  });
  it('allows unmatched paths', () => {
    expect(robotsAllowProjects('User-agent: *\nDisallow: /admin', '/projects')).toBe(true);
  });
});
