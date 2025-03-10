import { Request, Response } from 'express';
import { MyRequest, MyResponse } from '../types/server';
import constants from '../utils/constants';
import models, { relationships } from '../models';
import { compare } from '../utils/password';
import { decryptToken, generateToken } from '../utils/jwt';
import { notFoundChecker } from '../utils/db';
import dataParser from '../utils/dataparser';
import includes from '../utils/includes';
import { AdopterFromDb, ShelterFromDb } from '../types/dboutputs';
import { v4 as uuidv4 } from 'uuid';
import { Adopter, Shelter } from '../types/models';
import triggerInternalServerError from '../utils/coverage';
import getUserInfoFromToken from '../utils/google';

const { User, Adopter, Shelter, Token } = models;

const controller = {
  login: async (req: Request, res: Response) => {
    const response = { ...constants.fallbackResponse } as MyResponse;

    try {
      const user = await User.findOne({
        where: { email: req.body.email },
        include: [relationships.user.adopter, relationships.user.shelter]
      });

      let adopter: string | null = null;
      let shelter: string | null = null;

      if (user !== null) {
        adopter = (user as unknown as { adopter: string }).adopter;
        shelter = (user as unknown as { shelter: string }).shelter;
      }

      const type = adopter === null && shelter !== null ? 'shelter' : 'adopter';

      if (
        user === null ||
        !(await compare(
          req.body.password,
          (user as unknown as { password: string }).password
        ))
      ) {
        response.status = constants.statusCodes.badRequest;
        response.message = 'Email or password not correct';
        throw new Error(response.message);
      }
      const id =
        type === 'adopter'
          ? (user as unknown as { adopter: { id: number } }).adopter.id
          : (user as unknown as { shelter: { id: number } }).shelter.id;

      const responseToken = await Token.create({
        id: uuidv4(),
        content: generateToken({
          id,
          type
        })
      });

      response.token = (
        responseToken as unknown as { content: string }
      ).content;
      response.status = constants.statusCodes.ok;
      response.message = `${type[0].toUpperCase()}${type.slice(
        1
      )} logged in successfully!`;
      response.data = id;
    } catch (err) {
      console.warn('ERROR AT AUTH-CONTROLLER-login: ', err);
    }

    res.status(response.status).send(response);
  },

  profile: async (req: MyRequest, res: Response) => {
    const response = { ...constants.fallbackResponse } as MyResponse;

    try {
      const decryptedToken = decryptToken(req.token as string) as unknown as {
        id: string;
        type: string;
      };

      if (decryptedToken.type === 'adopter') {
        const adopter = await Adopter.findByPk(decryptedToken.id, {
          include: includes.adopter
        });
        notFoundChecker(adopter, decryptedToken.id, response, 'Adopter');

        response.data = dataParser.adopter(adopter as unknown as AdopterFromDb);
      } else if (decryptedToken.type === 'shelter') {
        const shelter = await Shelter.findByPk(decryptedToken.id, {
          include: includes.shelter
        });
        notFoundChecker(shelter, decryptedToken.id, response, 'Shelter');

        response.data = dataParser.shelter(shelter as unknown as ShelterFromDb);
      } else {
        response.status = 418;
        response.message =
          'Why are you trying to retrieve your profile admin? lol 🤓';

        throw new Error('Admin profile');
      }
      response.status = constants.statusCodes.ok;
      response.message = 'Profile retrieved successfully!';
    } catch (err) {
      console.warn('ERROR AT AUTH-CONTROLLER-profile: ', err);
    }

    res.status(response.status).send(response);
  },

  logout: async (req: MyRequest, res: Response) => {
    const response = { ...constants.fallbackResponse } as MyResponse;
    
    try {
      triggerInternalServerError(req);
      await Token.destroy({
        where: { content: req.token }
      });

      response.status = constants.statusCodes.ok;
      response.message = 'User logged out successfully!';
    } catch (err) {
      console.warn('ERROR AT AUTH-CONTROLLER-logout: ', err);
    }

    res.status(response.status).send(response);
  },

  google: async (req: MyRequest, res: Response) => {
    const response = { ...constants.fallbackResponse } as MyResponse;

    try {
      const userInfo = await getUserInfoFromToken(req.body.token);
      if (userInfo === null) {
        response.status = constants.statusCodes.unAuthorized;
        response.message = 'Google token not valid or not provided';
        throw new Error(response.message);
      }

      const user = await User.findOne({
        include: [
          {
            association: relationships.user.adopter,
            where: { google_id: userInfo.google_id }
          }
        ]
      });

      if (user !== null) {
        const adopter = (user as unknown as { adopter: AdopterFromDb }).adopter;

        if (adopter !== null) {
          const token = await Token.create({
            id: uuidv4(),
            content: generateToken({ id: adopter.id, type: 'adopter' })
          });
          
          response.token = (token as unknown as { content: string }).content;
        }

        response.status = constants.statusCodes.ok;
        response.message = 'User logged in successfully with google';
      } else {
        response.status = constants.statusCodes.ok;
        response.message = 'User registered with google';
        response.data = userInfo;
      }
    } catch (err) {
      console.warn('ERROR AT AUTH-CONTROLLER-google: ', err);
    }

    res.status(response.status).send(response);
  },

  verify: (req: Request, res: Response) => {
    const response = {
      status: constants.statusCodes.ok,
      message: 'The fields provided are correct'
    };
    res.status(response.status).send(response);
  }
};

export default controller;
